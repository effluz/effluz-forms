import type { Clock } from "@/shared/application/ports/clock";

export const systemClock: Clock = { now: () => new Date() };
