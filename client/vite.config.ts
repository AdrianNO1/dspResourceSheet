import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function getGitHubPagesBase() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    return "/";
  }

  const [owner, name] = repository.split("/");
  if (!owner || !name) {
    return "/";
  }

  // User and organization Pages sites are served from the domain root.
  if (name.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return "/";
  }

  return `/${name}/`;
}

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === "true" ? getGitHubPagesBase() : "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
  },
});
