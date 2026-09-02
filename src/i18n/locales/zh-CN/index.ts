// ─── zh-CN catalogue ────────────────────────────────────────────────────────
//
// Simplified Chinese — the product default locale.
//
// Key-for-key mirror of `../en-US`. `src/i18n/__tests__/i18n-parity.test.ts` fails the build
// when a key is missing here or here-only, so the two catalogues can never
// drift apart.

import type { Catalog } from "../../types";
import common from "./common";
import errors from "./errors";
import shared from "./shared";
import sidebar from "./sidebar";
import tabs from "./tabs";
import dashboard from "./dashboard";
import host from "./host";
import explorer from "./explorer";
import sftp from "./sftp";
import s3 from "./s3";
import terminal from "./terminal";
import snippets from "./snippets";
import transfers from "./transfers";
import portforward from "./portforward";
import history from "./history";
import settings from "./settings";
import updater from "./updater";

/** Prefix every key of a namespace catalogue with `<ns>.`. */
function ns(name: string, entries: Record<string, string>): Catalog {
  const out: Catalog = {};
  for (const [key, value] of Object.entries(entries)) {
    out[`${name}.${key}`] = value;
  }
  return out;
}

export default {
  ...ns("common", common),
  ...ns("errors", errors),
  ...ns("shared", shared),
  ...ns("sidebar", sidebar),
  ...ns("tabs", tabs),
  ...ns("dashboard", dashboard),
  ...ns("host", host),
  ...ns("explorer", explorer),
  ...ns("sftp", sftp),
  ...ns("s3", s3),
  ...ns("terminal", terminal),
  ...ns("snippets", snippets),
  ...ns("transfers", transfers),
  ...ns("portforward", portforward),
  ...ns("history", history),
  ...ns("settings", settings),
  ...ns("updater", updater),
} satisfies Catalog;
