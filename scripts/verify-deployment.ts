import { verifyDeployment } from "./lib/deployment-health";

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    throw new Error(
      "用法：bun run verify:deployment -- https://example.com/",
    );
  }

  const report = await verifyDeployment(args[0]);

  console.log(`部署检查通过：首页 ${report.pageUrl}`);
  for (const asset of report.assets) {
    console.log(
      `- ${asset.kind === "script" ? "脚本" : "样式"} ${asset.url}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
