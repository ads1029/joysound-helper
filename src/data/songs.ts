import catalog from "./generated/joysound-production-catalog.json";

import type { Song } from "../types";

export const songs = catalog.songs as Song[];
