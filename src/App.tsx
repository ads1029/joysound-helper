import {
  type ChangeEvent,
  type CompositionEvent,
  type FormEvent,
  type KeyboardEvent,
  useRef,
  useState,
} from "react";

import { SongResult } from "./components/SongResult";
import { songs } from "./data/songs";
import { normalizeSearchText } from "./lib/normalize";
import { getPaginationItems } from "./lib/pagination";
import {
  CATALOG_PAGE_SIZE,
  listSongsByRomaji,
  searchSongs,
  searchSongsByArtist,
} from "./lib/search";

type SearchMode = "song" | "artist";

const songExamples = [
  "ふぁむ",
  "千本",
  "千本樱",
  "夜に駆ける",
  "夜に驱ける",
  "残酷天使",
];

const artistExamples = [
  "米津玄師",
  "Ado",
  "藤井风",
  "Mrs. GREEN APPLE",
];

const searchModes: SearchMode[] = ["song", "artist"];
const catalogSongs = listSongsByRomaji(songs);

export default function App() {
  const [searchMode, setSearchMode] = useState<SearchMode>("song");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const isComposingRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const songTabRef = useRef<HTMLButtonElement>(null);
  const artistTabRef = useRef<HTMLButtonElement>(null);

  const hasQuery = activeQuery.trim().length > 0;
  const normalizedQuery = normalizeSearchText(activeQuery);
  const partialQueryLength = Array.from(
    normalizedQuery.replace(/ー/g, ""),
  ).length;
  const searchResults = hasQuery
    ? searchMode === "song"
      ? searchSongs(songs, activeQuery)
      : searchSongsByArtist(songs, activeQuery)
    : [];
  const activeExamples =
    searchMode === "song" ? songExamples : artistExamples;
  const allResults = hasQuery ? searchResults : catalogSongs;
  const totalPages = Math.max(
    1,
    Math.ceil(allResults.length / CATALOG_PAGE_SIZE),
  );
  const pageStart = (currentPage - 1) * CATALOG_PAGE_SIZE;
  const paginationItems = getPaginationItems(totalPages, currentPage);
  const results = allResults.slice(
    pageStart,
    pageStart + CATALOG_PAGE_SIZE,
  );
  const emptyState =
    hasQuery && allResults.length === 0
      ? normalizedQuery.length === 0
        ? {
            title: `请输入可搜索的${searchMode === "song" ? "歌名" : "歌手名"}`,
            description: "搜索仅识别汉字、平假名、片假名和英文字母。",
          }
        : partialQueryLength < 2
          ? {
              title: "再输入一个字符",
              description: `片段搜索至少需要两个字符，完整的单字${
                searchMode === "song" ? "歌名" : "歌手名"
              }除外。`,
            }
          : {
              title: `没有找到匹配的${
                searchMode === "song" ? "歌名" : "歌手"
              }`,
              description:
                searchMode === "song"
                  ? "可以尝试缩短歌名；标点、空格、数字和中日汉字字形会自动处理。"
                  : "可以尝试缩短歌手名；空格、大小写、标点和中日汉字字形会自动处理。",
            }
      : null;

  function updateSearch(nextQuery: string) {
    setActiveQuery(nextQuery);
    setCurrentPage(1);
  }

  function handleQueryChange(event: ChangeEvent<HTMLInputElement>) {
    const nextQuery = event.target.value;

    setQuery(nextQuery);

    if (!isComposingRef.current) {
      updateSearch(nextQuery);
    }
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    isComposingRef.current = false;
    updateSearch(event.currentTarget.value);
  }

  function applyExample(nextQuery: string) {
    setQuery(nextQuery);
    updateSearch(nextQuery);
  }

  function clearSearch() {
    setQuery("");
    updateSearch("");
    searchInputRef.current?.focus();
  }

  function selectSearchMode(nextMode: SearchMode) {
    if (nextMode === searchMode) {
      return;
    }

    setSearchMode(nextMode);
    setQuery("");
    updateSearch("");
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentMode: SearchMode,
  ) {
    const currentIndex = searchModes.indexOf(currentMode);
    let nextMode: SearchMode | undefined;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextMode = searchModes[(currentIndex + 1) % searchModes.length];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextMode =
        searchModes[
          (currentIndex - 1 + searchModes.length) % searchModes.length
        ];
    } else if (event.key === "Home") {
      nextMode = searchModes[0];
    } else if (event.key === "End") {
      nextMode = searchModes[searchModes.length - 1];
    }

    if (!nextMode) {
      return;
    }

    event.preventDefault();
    selectSearchMode(nextMode);
    const nextTabRef =
      nextMode === "song" ? songTabRef : artistTabRef;
    nextTabRef.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        <h2 id="intro-title">输入歌名或歌手，找到点歌编号</h2>
        <p>
          中日汉字会自动统一。输入 <code>千本樱</code>、<code>千本櫻</code>
          或 <code>千本桜</code>，都能找到同一首歌；输入 <code>ふぁむ</code>
          也能匹配“・ふぁむ・ふぁた～る・”。还可以只输入歌名中的汉字，例如用
          <code>残酷天使</code> 搜索“残酷な天使のテーゼ”，或切换到歌手搜索
          该歌手的全部收录歌曲。
        </p>
      </section>

      <section className="search-section" aria-label="曲库搜索">
        <div className="search-tabs" role="tablist" aria-label="搜索方式">
          <button
            ref={songTabRef}
            id="song-search-tab"
            type="button"
            role="tab"
            aria-selected={searchMode === "song"}
            aria-controls="search-panel"
            tabIndex={searchMode === "song" ? 0 : -1}
            onClick={() => selectSearchMode("song")}
            onKeyDown={(event) => handleTabKeyDown(event, "song")}
          >
            <span aria-hidden="true">曲</span>
            歌曲
          </button>
          <button
            ref={artistTabRef}
            id="artist-search-tab"
            type="button"
            role="tab"
            aria-selected={searchMode === "artist"}
            aria-controls="search-panel"
            tabIndex={searchMode === "artist" ? 0 : -1}
            onClick={() => selectSearchMode("artist")}
            onKeyDown={(event) => handleTabKeyDown(event, "artist")}
          >
            <span aria-hidden="true">人</span>
            歌手
          </button>
        </div>

        <div
          id="search-panel"
          role="tabpanel"
          aria-labelledby={`${searchMode}-search-tab`}
        >
          <form
            className="search-form"
            role="search"
            onSubmit={handleSubmit}
          >
            <div className="search-label-row">
              <label htmlFor="search-query">
                {searchMode === "song" ? "歌曲名称" : "歌手名称"}
              </label>
              <span className="live-search-indicator">
                <span aria-hidden="true" />
                输入即搜索
              </span>
            </div>
            <div className="search-row">
              <input
                ref={searchInputRef}
                type="search"
                id="search-query"
                value={query}
                onChange={handleQueryChange}
                onCompositionStart={handleCompositionStart}
                onCompositionEnd={handleCompositionEnd}
                placeholder={
                  searchMode === "song"
                    ? "例如：ふぁむ 或 残酷天使"
                    : "例如：米津玄師 或 Mrs. GREEN APPLE"
                }
                autoComplete="off"
                maxLength={120}
                enterKeyHint="search"
                aria-controls="song-results"
                aria-describedby="search-help"
              />
              {query.length > 0 && (
                <button
                  className="search-clear"
                  type="button"
                  aria-label="清空搜索"
                  onClick={clearSearch}
                >
                  清空
                </button>
              )}
            </div>
            <p className="form-help" id="search-help">
              {searchMode === "song"
                ? "结果随输入即时更新；片段搜索至少需要两个字符，不匹配翻译名。"
                : "结果随输入即时更新；支持完整歌手名、至少两个字符的片段及合作署名。"}
            </p>
          </form>
        </div>

        <div
          className="examples"
          role="group"
          aria-label="搜索示例"
        >
          <span>试一试：</span>
          {activeExamples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => applyExample(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </section>

      <section
        id="song-results"
        className="result-region"
      >
        {emptyState && (
          <div className="empty-state" role="status">
            <strong>{emptyState.title}</strong>
            <p>{emptyState.description}</p>
          </div>
        )}

        {results.length > 0 && (
          <>
            <div
              className="result-summary"
              aria-live="polite"
              aria-atomic="true"
            >
              <div>
                <p>
                  {hasQuery
                    ? searchMode === "song"
                      ? "歌曲即时搜索结果"
                      : "歌手即时搜索结果"
                    : "歌曲目录"}
                </p>
                <h2>
                  {hasQuery
                    ? `找到 ${allResults.length} 首歌曲`
                    : "按罗马音 A–Z 排列"}
                </h2>
              </div>
              {totalPages > 1 && (
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

            {totalPages > 1 && (
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
                  {paginationItems.map((item) => {
                    if (typeof item !== "number") {
                      return (
                        <span
                          key={item}
                          className="pagination-ellipsis"
                          aria-hidden="true"
                        >
                          …
                        </span>
                      );
                    }

                    return (
                      <button
                        key={item}
                        type="button"
                        className={item === currentPage ? "is-current" : ""}
                        aria-current={item === currentPage ? "page" : undefined}
                        aria-label={`第 ${item} 页`}
                        onClick={() => setCurrentPage(item)}
                      >
                        {item}
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
