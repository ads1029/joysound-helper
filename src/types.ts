export type VersionType =
  | "standard"
  | "official-video"
  | "anime-video"
  | "guide-vocal"
  | "guitar-guide"
  | "other";

export type SongVariant = {
  id: string;
  songNumber: string;
  versionTitle: string;
  versionType: VersionType;
  supportsX1: boolean;
};

export type Song = {
  id: string;
  title: string;
  romaji?: string;
  artist: string;
  sourceUrl: string;
  variants: SongVariant[];
};
