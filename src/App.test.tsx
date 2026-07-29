// @vitest-environment happy-dom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import App from "./App";

afterEach(cleanup);

describe("App", () => {
  it("按歌曲标题展示目录并支持分页", async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(
      screen.getByRole("heading", { name: "按歌曲标题排列" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^第 1 \/ \d+ 页$/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一页" }));

    expect(screen.getByText(/^第 2 \/ \d+ 页$/)).toBeInTheDocument();
  });

  it("输入歌曲片段后即时显示匹配结果并可清空", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.type(
      screen.getByRole("searchbox", { name: "歌曲名称" }),
      "千本樱",
    );

    expect(
      screen.getByRole("heading", { name: "找到 1 首歌曲" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "千本桜" }),
    ).toBeInTheDocument();
    expect(screen.getByText("116296")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空搜索" }));

    expect(
      screen.getByRole("heading", { name: "按歌曲标题排列" }),
    ).toBeInTheDocument();
  });

  it("切换到歌手搜索后更新输入框和结果", async () => {
    const user = userEvent.setup();

    render(<App />);

    await user.click(screen.getByRole("tab", { name: "歌手" }));

    const artistSearchbox = screen.getByRole("searchbox", {
      name: "歌手名称",
    });
    expect(artistSearchbox).toBeInTheDocument();

    await user.type(artistSearchbox, "米津玄師");

    expect(
      screen.getByText("歌手即时搜索结果"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^找到 \d+ 首歌曲$/)).toBeInTheDocument();
  });

  it("输入法组合期间保留目录并在确认文字后更新结果", () => {
    render(<App />);

    const searchbox = screen.getByRole("searchbox", {
      name: "歌曲名称",
    });

    fireEvent.compositionStart(searchbox);
    fireEvent.change(searchbox, { target: { value: "千本樱" } });

    expect(
      screen.getByRole("heading", { name: "按歌曲标题排列" }),
    ).toBeInTheDocument();

    fireEvent.compositionEnd(searchbox);

    expect(
      screen.getByRole("heading", { name: "找到 1 首歌曲" }),
    ).toBeInTheDocument();
  });
});
