import { type FormEvent, useState } from "react";

import { SongResult } from "./components/SongResult";
import { songs } from "./data/songs";
import {
  CATALOG_PAGE_SIZE,
  listSongsByRomaji,
  searchSongs,
} from "./lib/search";

const examples = [
  "千本",
  "千本樱",
  "夜に駆ける",
  "夜に驱ける",
  "残酷天使",
];

export default function App() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const hasSearched = submittedQuery.length > 0;
  const catalogSongs = listSongsByRomaji(songs);
  const searchResults = searchSongs(songs, submittedQuery);
  const totalPages = Math.max(
    1,
    Math.ceil(catalogSongs.length / CATALOG_PAGE_SIZE),
  );
  const pageStart = (currentPage - 1) * CATALOG_PAGE_SIZE;
  const results = hasSearched
    ? searchResults
    : catalogSongs.slice(pageStart, pageStart + CATALOG_PAGE_SIZE);

  function submitSearch(nextQuery: string) {
    const cleanQuery = nextQuery.trim();
    setQuery(nextQuery);
    setSubmittedQuery(cleanQuery);
    setCurrentPage(1);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitSearch(query);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="app-kicker">JOYSOUND X1</p>
          <h1>日语点歌助手</h1>
        </div>
        <span className="demo-badge">{songs.length} 首歌曲</span>
      </header>

      <section className="intro" aria-labelledby="intro-title">
        <h2 id="intro-title">输入歌名，找到点歌编号</h2>
        <p>
          中日汉字会自动统一。输入 <code>千本樱</code>、<code>千本櫻</code>
          或 <code>千本桜</code>，都能找到同一首歌；输入 <code>千本</code>
          也能模糊匹配“千本桜”。还可以只输入歌名中的汉字，例如用
          <code>残酷天使</code> 搜索
          “残酷な天使のテーゼ”。
        </p>
      </section>

      <section className="search-section" aria-label="歌曲搜索">
        <form className="search-form" onSubmit={handleSubmit}>
          <label htmlFor="song-name">歌曲名称</label>
          <div className="search-row">
            <input
              id="song-name"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：千本 或 残酷天使"
              autoComplete="off"
              maxLength={120}
              enterKeyHint="search"
            />
            <button type="submit">查找编号</button>
          </div>
          <p className="form-help">
            支持完整歌名，或输入至少两个汉字模糊搜索；不搜索歌手或翻译名。
          </p>
        </form>

        <div className="examples" aria-label="搜索示例">
          <span>试一试：</span>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => submitSearch(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </section>

      <section
        id="song-results"
        className="result-region"
        aria-live="polite"
      >
        {hasSearched && results.length === 0 && (
          <div className="empty-state">
            <strong>没有找到匹配的歌名</strong>
            <p>
              请检查完整歌名或至少两个汉字。简体、繁体和日文汉字会自动转换。
            </p>
          </div>
        )}

        {results.length > 0 && (
          <>
            <div className="result-summary">
              <div>
                <p>{hasSearched ? "搜索结果" : "歌曲目录"}</p>
                <h2>
                  {hasSearched
                    ? `找到 ${results.length} 首歌曲`
                    : "按罗马音 A–Z 排列"}
                </h2>
              </div>
              {!hasSearched && (
                <span>
                  第 {currentPage} / {totalPages} 页
                </span>
              )}
            </div>

            <div className="result-list">
              {results.map((result) => (
                <SongResult key={result.id} song={result} />
              ))}
            </div>

            {!hasSearched && totalPages > 1 && (
              <nav className="pagination" aria-label="歌曲分页">
                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage((page) => Math.max(1, page - 1))
                  }
                  disabled={currentPage === 1}
                >
                  上一页
                </button>

                <div className="page-numbers">
                  {Array.from({ length: totalPages }, (_, index) => {
                    const page = index + 1;

                    return (
                      <button
                        key={page}
                        type="button"
                        className={page === currentPage ? "is-current" : ""}
                        aria-current={page === currentPage ? "page" : undefined}
                        aria-label={`第 ${page} 页`}
                        onClick={() => setCurrentPage(page)}
                      >
                        {page}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setCurrentPage((page) => Math.min(totalPages, page + 1))
                  }
                  disabled={currentPage === totalPages}
                >
                  下一页
                </button>
              </nav>
            )}
          </>
        )}
      </section>

      <footer className="app-footer">
        数据随网页一起提供 · 无后端 · 只显示 JOYSOUND X1 版本
      </footer>
    </main>
  );
}
