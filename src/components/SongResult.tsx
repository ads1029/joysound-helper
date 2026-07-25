import type { SearchResult } from "../lib/search";
import type { VersionType } from "../types";

const versionLabels: Record<VersionType, string> = {
  standard: "普通版",
  "official-video": "本人映像",
  "anime-video": "动画映像",
  "guide-vocal": "导唱",
  "guitar-guide": "吉他导航",
  other: "其他版本",
};

export function SongResult({ song }: { song: SearchResult }) {
  return (
    <article className="result-card">
      <header className="result-header">
        <div>
          {song.romaji && <p className="song-romaji">{song.romaji}</p>}
          <h2>{song.title}</h2>
          <p className="song-artist">{song.artist}</p>
        </div>
      </header>

      <div className="variant-list">
        {song.variants.map((variant) => (
          <div className="variant-row" key={variant.id}>
            <div className="variant-info">
              <strong>{versionLabels[variant.versionType]}</strong>
              <span>{variant.versionTitle}</span>
            </div>

            <div className="number-info">
              <span>点歌编号</span>
              <strong>{variant.songNumber}</strong>
            </div>
          </div>
        ))}
      </div>

      <a
        className="source-link"
        href={song.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        查看 JOYSOUND 官方页面
      </a>
    </article>
  );
}
