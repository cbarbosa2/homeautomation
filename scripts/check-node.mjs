const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 26 || minor < 13) {
  throw new Error("Node.js 26.13 or newer in the 26.x LTS line is required");
}
