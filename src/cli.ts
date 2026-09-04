import packageMetadata from "../package.json" with { type: "json" };

const arguments_ = process.argv.slice(2);
const [argument] = arguments_;

if (
  arguments_.length === 0 ||
  (arguments_.length === 1 && argument === "--help")
) {
  console.log("Usage: flow [options]");
} else if (arguments_.length === 1 && argument === "--version") {
  console.log(packageMetadata.version);
} else {
  const label = arguments_.length === 1 ? "argument" : "arguments";
  console.error(`Unsupported ${label}: ${arguments_.join(" ")}`);
  process.exitCode = 1;
}
