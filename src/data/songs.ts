import catalog from "./generated/joysound-expanded-catalog.json";

import type { Song } from "../types";

export const songs = catalog.songs as Song[];
