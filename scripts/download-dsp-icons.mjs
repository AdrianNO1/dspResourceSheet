import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const outputDir = path.join(rootDir, "client", "public", "icons", "game");

const categoryTitles = [
  "Category:Buildings",
  "Category:Components",
  "Category:End Products",
  "Category:Environment Modification",
  "Category:Fuels",
  "Category:Gathering",
  "Category:Logistics",
  "Category:Materials",
  "Category:Power",
  "Category:Production",
  "Category:Research",
  "Category:Science Matrices",
  "Category:Storage",
  "Category:Transportation",
];

const extraTitles = [
  "Assembling Machine Mk.I",
  "Assembling Machine Mk.II",
  "Assembling Machine Mk.III",
  "Arc Smelter",
  "Matrix Lab",
  "Miniature Particle Collider",
  "Oil Refinery",
  "Mining Machine",
  "Advanced Mining Machine",
  "Chemical Plant",
  "Quantum Chemical Plant",
  "Plane Smelter",
  "Negentropy Smelter",
  "Re-Composing Assembler",
  "Self-Evolution Lab",
  "Water Pump",
  "Spray Coater",
  "Iron Ore",
  "Copper Ore",
  "Titanium Ore",
  "Silicon Ore",
  "Kimberlite Ore",
  "Fractal Silicon",
  "Grating Crystal",
  "Stalagmite Crystal",
  "Stone",
  "Water",
  "Proliferator Mk.I",
  "Proliferator Mk.II",
  "Proliferator Mk.III",
];

const fileTitleAliases = new Map([
  ["Assembler", "Assembling Machine Mk.I"],
  ["Sorter", "Sorter MK.I"],
  ["Storage", "Storage MK.I"],
]);

const skippedTitles = new Set([
  "Components",
  "Fuel Chamber Power Generation Boost",
]);

function normalizeKey(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.'()]/g, "")
    .replace(/&/g, "and")
    .replace(/[_\s/]+/g, "-")
    .replace(/-+/g, "-");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.json();
}

async function fetchCategoryPages(categoryTitle) {
  const titles = [];
  let continueToken = "";

  while (true) {
    const url = new URL("https://dyson-sphere-program.fandom.com/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("list", "categorymembers");
    url.searchParams.set("cmtitle", categoryTitle);
    url.searchParams.set("cmtype", "page");
    url.searchParams.set("cmlimit", "max");
    url.searchParams.set("format", "json");
    if (continueToken) {
      url.searchParams.set("cmcontinue", continueToken);
    }

    const payload = await fetchJson(url);
    const members = payload.query?.categorymembers ?? [];
    for (const member of members) {
      if (typeof member.title === "string") {
        titles.push(member.title);
      }
    }

    if (!payload.continue?.cmcontinue) {
      break;
    }
    continueToken = payload.continue.cmcontinue;
  }

  return titles;
}

async function fetchImageUrl(fileTitle) {
  const url = new URL("https://dyson-sphere-program.fandom.com/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("titles", `File:${fileTitle}.png`);
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url");
  url.searchParams.set("format", "json");

  const payload = await fetchJson(url);
  const pages = payload.query?.pages ?? {};
  const page = Object.values(pages)[0];
  return page?.imageinfo?.[0]?.url ?? null;
}

async function downloadIcon(title) {
  if (skippedTitles.has(title)) {
    return { title, status: "skipped" };
  }

  const imageUrl = await fetchImageUrl(fileTitleAliases.get(title) ?? title);
  if (!imageUrl) {
    return { title, status: "missing" };
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    return { title, status: "failed" };
  }

  const outputPath = path.join(outputDir, `${normalizeKey(title)}.png`);
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(outputPath, Buffer.from(arrayBuffer));
  return { title, status: "downloaded" };
}

await fs.mkdir(outputDir, { recursive: true });

const categoryResults = await Promise.all(categoryTitles.map((title) => fetchCategoryPages(title)));
const titles = Array.from(new Set([...categoryResults.flat(), ...extraTitles])).sort((a, b) => a.localeCompare(b));

let downloaded = 0;
let missing = 0;

for (const title of titles) {
  const result = await downloadIcon(title);
  if (result.status === "downloaded") {
    downloaded += 1;
  } else if (result.status === "missing") {
    missing += 1;
  }
}

console.log(`Downloaded ${downloaded} icons to ${outputDir}. Missing ${missing}.`);
