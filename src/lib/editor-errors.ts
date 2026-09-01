// Shared formatting for editor-launch failures surfaced to the user.
//
// Backend edit commands reject with a serialized error of the shape
// `{ kind, message }` (see SftpError / ScpError / S3Error). We previously
// swallowed these entirely, so launch failures looked like "nothing happened"
// (issues #12, #45, #56). This pulls out a message worth showing in a toast.

import { localizeBackendError } from "./backend-errors";
import { t } from "../i18n";

export function editorLaunchErrorMessage(err: unknown): string {
  const localized = localizeBackendError(err);
  if (localized) return localized;
  return t("settings.editors.launchFailedHint");
}
