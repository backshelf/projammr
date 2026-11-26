// turbo appends `--max-warnings 0` to every workspace's `lint` script; cargo would reject it, so argv is ignored.
const commands = [
  ["cargo", "fmt", "--check"],
  ["cargo", "clippy", "--workspace", "--all-targets", "--", "-D", "warnings"],
  ["bun", "--bun", "eslint", ".", "--max-warnings", "0"],
];

for (const command of commands) {
  const { exitCode } = Bun.spawnSync(command, {
    stdio: ["inherit", "inherit", "inherit"],
  });
  if (exitCode !== 0) process.exit(exitCode);
}
