// ─── s3 (zh-CN) ───────────────────────────────────────────────────────
//
// S3 connect dialog and bucket browser.
//
// Keys are written WITHOUT the `s3.` prefix — the locale index adds it.
// Must mirror ../en-US/s3.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).

export default {
  // ─── Page (S3Page) ───────────────────────────────────────────────────────
  "page.title": "云存储",
  "page.subtitle": "浏览并管理 S3 存储桶，以及 MinIO、R2、Wasabi 等 S3 兼容存储中的文件",
  "page.searchPlaceholder": "搜索连接...",
  "page.searchAriaLabel": "搜索 S3 连接",
  "page.newConnection": "新建连接",
  "page.saved": "已保存",
  "page.active": "进行中",
  "page.noMatch": "没有匹配“{query}”的连接",
  "page.emptyTitle": "暂无 S3 连接",
  "page.emptyHint": "连接到 Amazon S3、MinIO、Cloudflare R2 或任意 S3 兼容存储",
  "page.deleteTitle": "删除此 S3 连接？",
  "page.deleteMessage": "该连接将被永久移除。",

  // ─── Connect / edit dialog (S3ConnectDialog) ─────────────────────────────
  "dialog.titleNew": "连接对象存储",
  "dialog.titleEdit": "编辑对象存储连接",
  "dialog.saving": "保存中…",
  "dialog.connecting": "连接中…",
  "dialog.saveFailed": "保存失败",
  "dialog.connectFailed": "连接失败",
  "dialog.section.provider": "服务商",
  "dialog.section.credentials": "凭据",
  "dialog.section.connection": "连接",
  "dialog.section.appearance": "外观",
  "dialog.section.notes": "备注",
  "dialog.service": "服务",
  "dialog.labelPlaceholder": "我的 S3 存储桶",
  "dialog.keepCredentials": "留空则保留现有凭据",
  "dialog.accessKey": "访问密钥 ID",
  "dialog.accessKeyPlaceholder": "AKIAIOSFODNN7EXAMPLE",
  "dialog.secretKey": "秘密访问密钥",
  "dialog.secretKeyPlaceholder": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "dialog.credentialPlaceholder": "••••••••••••",
  "dialog.region": "区域",
  "dialog.bucket": "存储桶",
  "dialog.endpoint": "Endpoint URL",
  "dialog.endpointPlaceholder": "https://s3.example.com",
  "dialog.group": "分组",
  "dialog.noGroup": "无分组",
  "dialog.environment": "环境",
  "dialog.environment.production": "生产",
  "dialog.environment.staging": "预发布",
  "dialog.environment.dev": "开发",
  "dialog.environment.testing": "测试",
  "dialog.colorAria": "颜色 {color}",
  "dialog.notesPlaceholder": "关于此连接的备注...",

  // ─── Browser (S3Browser) ─────────────────────────────────────────────────
  "browser.buckets": "存储桶",
  "browser.noBuckets": "未找到存储桶",
  "browser.downloadTitle": '下载 "{name}"',
  "browser.uploadFileTitle": "上传文件",
  "browser.uploadFolderTitle": "上传文件夹",
  "browser.listBucketsFailed": "列出存储桶失败",
  "browser.listObjectsFailed": "列出对象失败",
  "browser.switchBucketFailed": "切换存储桶失败",
  "browser.backToBuckets": "返回存储桶列表",
};
