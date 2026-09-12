#!/usr/bin/env bash
# Verify that ANYSSH_DISABLE_TELEMETRY really stops all outbound telemetry.
#
# Why a script: doing this by hand is easy to get wrong in a way that looks
# like success. Reading a pcap that was never written prints nothing, and if
# stderr is discarded `wc -l` reports 0 — which reads exactly like "telemetry
# is off". This script refuses to report a verdict unless the control group
# first proves the capture actually works.
#
# Run it from a normal terminal (not a sandbox): tcpdump needs root, and the
# app must be launched so its stdout is visible.
#
#   ./scripts/telemetry-capture.sh
#
# It will ask for your sudo password (for tcpdump) twice, once per group.

set -uo pipefail

APP="${ANYSSH_APP:-/Applications/anySSH.app/Contents/MacOS/anyssh}"
HOST="us.i.posthog.com"
[ -x "$APP" ] || { echo "✗ 找不到应用：$APP"; exit 1; }

# ── 1. Preflight: tcpdump must actually run ────────────────────────────────
# Deliberately not silencing stderr — if this fails we want the reason.
if ! sudo -n true 2>/dev/null && ! sudo -v 2>/dev/null; then
    echo "✗ 需要 sudo 才能抓包（tcpdump 要访问 /dev/bpf*）"
    exit 1
fi

IP="$(dig +short "$HOST" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | head -1)"
[ -n "$IP" ] || { echo "✗ 无法解析 $HOST，先检查 DNS"; exit 1; }
echo "端点 $HOST -> $IP"
echo

# ── 2. Capture one group ───────────────────────────────────────────────────
# $1 = group name, remaining args = env for the app
capture_group() {
    local group="$1"; shift
    local pcap="/tmp/tel-$group.pcap"
    local log="/tmp/tel-$group-app.log"

    rm -f "$pcap"
    pkill -TERM -x anyssh 2>/dev/null; sleep 2

    sudo tcpdump -i any -n -s 0 -w "$pcap" "host $IP" >/dev/null 2>/tmp/tel-$group-tcpdump.err &
    local tcp=$!
    sleep 2
    if ! sudo kill -0 "$tcp" 2>/dev/null; then
        echo "✗ tcpdump 没起来："
        cat "/tmp/tel-$group-tcpdump.err"
        return 2
    fi

    echo "── 组 [$group]：应用已启动，请做这些动作 ──"
    echo "   连一台主机 → 开 SFTP → 起一次传输 → 退出应用"
    env "$@" "$APP" > "$log" 2>&1 &
    local app=$!

    read -r -p "   做完按回车停止本组抓包... "

    kill -TERM "$app" 2>/dev/null; sleep 1; kill -9 "$app" 2>/dev/null
    sudo kill -TERM "$tcp" 2>/dev/null; sleep 1; sudo kill -9 "$tcp" 2>/dev/null
    sleep 1

    # The guard that matters: a missing or empty file means the capture told
    # us nothing, and a verdict from it would be fabricated.
    if [ ! -s "$pcap" ]; then
        echo "✗ [$group] $pcap 不存在或为空 ⇒ 本组抓包无效"
        return 2
    fi

    local n
    n=$(tcpdump -r "$pcap" -n 2>/dev/null | wc -l | tr -d ' ')
    echo "   [$group] 抓到 $n 个包"
    echo "$n" > "/tmp/tel-$group-count"
    return 0
}

# ── 3. Control first, then experiment ──────────────────────────────────────
rm -f /tmp/tel-ctl-count /tmp/tel-off-count

capture_group ctl
ctl_ok=$?
[ "$ctl_ok" -eq 0 ] || { echo; echo "✗ 对照组失败，不再继续：没有对照组就无法解释实验组的 0"; exit 1; }

echo
capture_group off ANYSSH_DISABLE_TELEMETRY=1
off_ok=$?

echo
echo "════ 结论 ════"
if [ "$off_ok" -ne 0 ]; then
    echo "✗ 实验组抓包无效 ⇒ 未判定，请排查后重跑"
    exit 1
fi

CTL=$(cat /tmp/tel-ctl-count)
OFF=$(cat /tmp/tel-off-count)
echo "对照组（默认启动）      : $CTL 个包"
echo "实验组（禁用遥测启动）  : $OFF 个包"
echo

if [ "$CTL" -eq 0 ]; then
    echo "✗ 对照组为 0 ⇒ 抓包仍然无效（换网卡/换工具重做），不得据此判定通过"
elif [ "$OFF" -eq 0 ]; then
    echo "✓ 通过：对照组有出站、禁用后为零"
else
    echo "✗ 不通过：禁用后仍有 $OFF 个包 ⇒ 按安全问题上报"
fi
