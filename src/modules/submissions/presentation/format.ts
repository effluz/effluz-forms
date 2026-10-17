import type { Locale } from "@/shared/domain/localized-text";

type Kinds = readonly ("image" | "video")[];

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

/** A number in the locale's digits and separators. */
export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** A size given in megabytes, such as "10 MB" (specs/ui-ux/renderer.md, `{size}`). */
export function formatMegabytes(mb: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "megabyte",
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(mb);
}

/** A size given in bytes: megabytes from 1 MB, otherwise whole kilobytes of at least 1. */
export function formatBytes(bytes: number, locale: Locale): string {
  if (bytes >= BYTES_PER_MB) return formatMegabytes(bytes / BYTES_PER_MB, locale);
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilobyte",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  }).format(Math.max(1, Math.round(bytes / BYTES_PER_KB)));
}

/** A calendar date such as "2026-11-09" in the locale; an unreadable date is returned as given. */
export function formatIsoDate(iso: string, locale: Locale): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(date);
}

/** An instant in the given IANA zone, with the zone's short name. */
export function formatInstant(iso: string, locale: Locale, timeZone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(instant);
}

/** The `kinds_*` chrome key naming what a field accepts (`{kinds}` in file messages). */
export function kindsKey(kinds: Kinds): "kinds_images" | "kinds_videos" | "kinds_mixed" {
  const image = kinds.includes("image");
  const video = kinds.includes("video");
  if (image && video) return "kinds_mixed";
  return video ? "kinds_videos" : "kinds_images";
}

/** The `files_limits_*` chrome key for the line under a file field. */
export function limitsKey(
  kinds: Kinds,
): "files_limits_images" | "files_limits_videos" | "files_limits_mixed" {
  const key = kindsKey(kinds);
  if (key === "kinds_mixed") return "files_limits_mixed";
  return key === "kinds_videos" ? "files_limits_videos" : "files_limits_images";
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic";
const VIDEO_ACCEPT = "video/mp4,video/quicktime";

/** The file input's `accept` list: a picker hint only, the server decides by content. */
export function acceptAttribute(kinds: Kinds): string {
  const parts: string[] = [];
  if (kinds.includes("image")) parts.push(IMAGE_ACCEPT);
  if (kinds.includes("video")) parts.push(VIDEO_ACCEPT);
  return parts.join(",");
}
