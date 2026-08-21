import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const releaseTag = process.env.GITHUB_REF_NAME ?? process.argv[2];

if (!releaseTag) {
  throw new Error("Pass the release tag as GITHUB_REF_NAME or the first argument.");
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));
const expectedVersion = releaseTag.startsWith("v") ? releaseTag.slice(1) : releaseTag;

if (manifest.version !== expectedVersion) {
  throw new Error(
    `Release tag ${releaseTag} does not match manifest version ${manifest.version}.`,
  );
}

if (packageJson.version !== manifest.version) {
  throw new Error(
    `package.json ${packageJson.version} does not match manifest ${manifest.version}.`,
  );
}

if (versions[manifest.version] !== manifest.minAppVersion) {
  throw new Error(
    `versions.json does not map ${manifest.version} to ${manifest.minAppVersion}.`,
  );
}

for (const artifact of ["main.js", "manifest.json", "styles.css"]) {
  if (!existsSync(artifact)) {
    throw new Error(`Required release artifact is missing: ${artifact}`);
  }
}

process.stdout.write(`Release ${releaseTag} is internally consistent.\n`);
