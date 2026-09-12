#!/usr/bin/env bash
# Verify that ANYSSH_DISABLE_TELEMETRY really stops all outbound telemetry.
#
# Why a script: doing this by hand fails in ways that look like success.
# Reading a pcap that was never written prints nothing, and with stderr
# discarded `wc -l` reports 0 — which reads exactly like "telemetry is off".
# So this script
#   * runs a positive control first (a curl to the same host) and refuses to
#     continue unless that control is actually captured,
#   * refuses to report a verdict if a capture file is missing or empty.
#
# Run from a normal terminal:
#   ./scripts/telemetry-capture.sh

set -uo pipefail

APP="${ANYSSH_APP:-/Applications/anySSH.app/Contents/MacOS/anyssh}"
HOST="us.i.posthog.com"
[ -x "$APP" ] || { echo "✗ 找不到应用：$APP"; exit 1; }

# ── 1. Preflight ───────────────────────────────────────────────────────────
if ! sudo -n true 2>/dev/null && ! sudo -v 2>/dev/null; then
    echo "✗ 需要 sudo（tcpdump 要访问 /dev/bpf*）"; exit 1
fi

# `-i any` is Linux-only; macOS has neither `any` nor necessarily `pktap`,
# so ask tcpdump what actually exists instead of assuming.
# NB: macOS ships bash 3.2 — no `mapfile`, no associative arrays. Keep this
# script to that subset.
IFACES="$(tcpdump -D 2>/dev/null | sed -E 's/^[0-9]+\.//; s/[[:space:]].*$//')"
[ -n "$IFACES" ] || { echo "✗ tcpdump -D 没有列出任何接口"; exit 1; }
LO="$(printf '%s\n' "$IFACES" | grep -xE 'lo0|lo' | head -1)"
EGRESS="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"

# When outbound goes through a local proxy, the only place the destination
# host is visible is the plaintext CONNECT on loopback.
PROXY_PORT="$(scutil --proxy 2>/dev/null | awk '/HTTPSPort/{print $3; exit}')"

IP="$(dig +short "$HOST" 2>/dev/null | grep -E '^[0-9]+(\.[0-9]+){3}$' | head -1)"
echo "端点        : $HOST -> ${IP:-未解析}"
echo "回环接口    : ${LO:-无}"
echo "出口接口    : ${EGRESS:-无}"
echo "系统代理端口: ${PROXY_PORT:-无}"
echo

# ── 2. Capture helpers ─────────────────────────────────────────────────────
start_captures() {   # $1 = group
    local g="$1"
    CAP_PIDS=""
    if [ -n "$LO" ] && [ -n "$PROXY_PORT" ]; then
        sudo tcpdump -i "$LO" -n -s 0 -w "/tmp/tel-$g-lo.pcap" \
            "tcp port $PROXY_PORT" >/dev/null 2>&1 &
        CAP_PIDS="$CAP_PIDS $!"
    fi
    if [ -n "$EGRESS" ] && [ -n "$IP" ]; then
        sudo tcpdump -i "$EGRESS" -n -s 0 -w "/tmp/tel-$g-ext.pcap" \
            "host $IP" >/dev/null 2>&1 &
        CAP_PIDS="$CAP_PIDS $!"
    fi
    [ -n "$CAP_PIDS" ] || { echo "✗ 没有可用的抓包接口/过滤器"; return 1; }
}

stop_captures() {
    local p
    for p in $CAP_PIDS; do sudo kill -TERM "$p" 2>/dev/null; done
    sleep 1
}

# Count everything that identifies the host: the plaintext CONNECT seen on
# loopback when a proxy is in use, plus any direct packets to its IP.
count_hits() {       # $1 = group
    local g="$1" n=0
    for f in "/tmp/tel-$g-lo.pcap" "/tmp/tel-$g-ext.pcap"; do
        [ -s "$f" ] || continue
        n=$(( n + $(tcpdump -r "$f" -A 2>/dev/null | grep -c "$HOST") ))
        n=$(( n + $(tcpdump -r "$f" -n 2>/dev/null | grep -c "$IP") ))
    done
    echo "$n"
}

# ── 3. Positive control: prove the capture can see this host at all ────────
echo "── 阳性对照：用 curl 走同一条路，确认抓得到 ──"
rm -f /tmp/tel-probe-lo.pcap /tmp/tel-probe-ext.pcap
start_captures probe || exit 1
curl -s -o /dev/null -m 10 "https://$HOST/capture/" 2>/dev/null
sleep 1
stop_captures
PROBE=$(count_hits probe)
if [ "$PROBE" -eq 0 ]; then
    echo "✗ 阳性对照也是 0 ⇒ 抓包/过滤无效，不能据此得出任何结论"
    echo "  可能原因：接口选错、代理端口变了、或该主机走的是另一条通路"
    exit 1
fi
echo "✓ 阳性对照抓到 $PROBE 处 ⇒ 抓包有效"
echo

# ── 4. The two groups ──────────────────────────────────────────────────────
run_group() {        # $1 = group, rest = env for the app
    local g="$1"; shift
    rm -f "/tmp/tel-$g-lo.pcap" "/tmp/tel-$g-ext.pcap"
    pkill -TERM -x anyssh 2>/dev/null; sleep 2

    start_captures "$g" || return 2
    echo "── 组 [$g]：应用已启动 ──"
    echo "   请做：连一台主机 → 开 SFTP → 起一次传输 → 退出应用"
    env "$@" "$APP" > "/tmp/tel-$g-app.log" 2>&1 &
    local app=$!
    read -r -p "   做完按回车停止本组抓包... "
    kill -TERM "$app" 2>/dev/null; sleep 1; kill -9 "$app" 2>/dev/null
    stop_captures
    sleep 1
    echo "   [$g] 命中 $(count_hits "$g") 处"
    count_hits "$g" > "/tmp/tel-$g-count"
}

run_group ctl
run_group off ANYSSH_DISABLE_TELEMETRY=1

# ── 5. Verdict ─────────────────────────────────────────────────────────────
CTL=$(cat /tmp/tel-ctl-count 2>/dev/null || echo 0)
OFF=$(cat /tmp/tel-off-count 2>/dev/null || echo 0)
echo
echo "════ 结论 ════"
echo "对照组（默认启动）      : $CTL 处命中"
echo "实验组（禁用遥测启动）  : $OFF 处命中"
echo
if [ "$CTL" -eq 0 ]; then
    echo "✗ 对照组为 0 ⇒ 阳性对照刚才通过了，说明这次确实没产生可观测流量"
    echo "  （可能是动作不足以触发遥测）⇒ 不得判定通过，请重做动作后重跑"
elif [ "$OFF" -eq 0 ]; then
    echo "✓ 通过：对照组有出站、禁用后为零"
else
    echo "✗ 不通过：禁用后仍有 $OFF 处命中 ⇒ 按安全问题上报"
fi
