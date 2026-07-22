import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const username = process.env.USERNAME || "kina2711";
const token = process.env.GITHUB_TOKEN || "";
const output = resolve("assets/generated/rabbit-telemetry.svg");

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "rabbit-profile-telemetry",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

const languageColors = {
  Python: "#3572A5",
  JavaScript: "#F1E05A",
  TypeScript: "#3178C6",
  HTML: "#E34C26",
  CSS: "#563D7C",
  SQL: "#E38C00",
  Jupyter: "#DA5B0B",
  "Jupyter Notebook": "#DA5B0B",
  Shell: "#89E051",
  Dockerfile: "#384D54",
};

const levelMap = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

async function graphqlSnapshot() {
  if (!token) return null;
  const query = `
    query ProfileTelemetry($login: String!) {
      user(login: $login) {
        contributionsCollection {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays { date contributionCount contributionLevel }
            }
          }
        }
        repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, orderBy: {field: UPDATED_AT, direction: DESC}) {
          totalCount
          nodes {
            stargazerCount
            forkCount
            languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
              edges { size node { name color } }
            }
          }
        }
      }
    }
  `;
  const response = await request("https://api.github.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: username } }),
  });
  const payload = await response.json();
  if (payload.errors) throw new Error(payload.errors.map((error) => error.message).join("; "));
  const user = payload.data.user;
  const contributions = user.contributionsCollection;
  const repos = user.repositories;
  const languages = new Map();
  let stars = 0;
  let forks = 0;
  for (const repo of repos.nodes) {
    stars += repo.stargazerCount;
    forks += repo.forkCount;
    for (const edge of repo.languages.edges) {
      const current = languages.get(edge.node.name) || { size: 0, color: edge.node.color };
      current.size += edge.size;
      languages.set(edge.node.name, current);
    }
  }
  return {
    contributions: contributions.contributionCalendar.totalContributions,
    commits: contributions.totalCommitContributions,
    prs: contributions.totalPullRequestContributions,
    issues: contributions.totalIssueContributions,
    repos: repos.totalCount,
    stars,
    forks,
    days: contributions.contributionCalendar.weeks.flatMap((week) =>
      week.contributionDays.map((day) => ({ ...day, level: levelMap[day.contributionLevel] || 0 })),
    ),
    languages,
  };
}

async function searchCount(query) {
  try {
    const response = await request(`https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=1`);
    return (await response.json()).total_count || 0;
  } catch {
    return 0;
  }
}

async function commitCount() {
  try {
    const response = await request(`https://api.github.com/search/commits?q=${encodeURIComponent(`author:${username}`)}&per_page=1`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    return (await response.json()).total_count || 0;
  } catch {
    return 0;
  }
}

async function publicSnapshot() {
  const repoResponse = await request(`https://api.github.com/users/${username}/repos?per_page=100&sort=updated`);
  const repos = (await repoResponse.json()).filter((repo) => !repo.fork);
  const languages = new Map();
  for (const repo of repos.slice(0, 45)) {
    try {
      const response = await request(repo.languages_url);
      const values = await response.json();
      for (const [name, size] of Object.entries(values)) {
        const current = languages.get(name) || { size: 0, color: languageColors[name] || "#64748B" };
        current.size += size;
        languages.set(name, current);
      }
    } catch {
      // A missing language breakdown should not break the entire profile build.
    }
  }

  const contributionHtml = await (await request(`https://github.com/users/${username}/contributions`)).text();
  const days = [...contributionHtml.matchAll(/data-date="([0-9-]+)"[^>]*data-level="([0-4])"/g)].map((match) => ({
    date: match[1],
    contributionCount: 0,
    level: Number(match[2]),
  }));
  const contributionCounts = [...contributionHtml.matchAll(/([0-9,]+) contributions? on /gi)]
    .map((match) => Number(match[1].replaceAll(",", "")));
  const contributions = contributionCounts.length
    ? contributionCounts.reduce((sum, value) => sum + value, 0)
    : days.filter((day) => day.level > 0).length;

  return {
    contributions,
    commits: await commitCount(),
    prs: await searchCount(`author:${username} type:pr`),
    issues: await searchCount(`author:${username} type:issue`),
    repos: repos.length,
    stars: repos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
    forks: repos.reduce((sum, repo) => sum + repo.forks_count, 0),
    days,
    languages,
  };
}

function compact(value) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function buildSvg(data) {
  const heat = ["#161B22", "#0E4429", "#006D32", "#26A641", "#39D353"];
  const days = data.days.slice(-371);
  const cells = days.map((day, index) => {
    const week = Math.floor(index / 7);
    const row = index % 7;
    const x = 68 + week * 13;
    const y = 154 + row * 13;
    return `<rect x="${x}" y="${y}" width="10" height="10" rx="2" fill="${heat[day.level] || heat[0]}"><title>${escapeXml(day.date)} · ${day.contributionCount || "activity"}</title></rect>`;
  }).join("");

  const stats = [
    ["CONTRIBUTIONS", compact(data.contributions), "#39D353"],
    ["COMMITS", compact(data.commits), "#38BDF8"],
    ["PULL REQUESTS", compact(data.prs), "#A78BFA"],
    ["ISSUES", compact(data.issues), "#F2712B"],
    ["PUBLIC REPOS", compact(data.repos), "#F5B02E"],
    ["STARS", compact(data.stars), "#34D399"],
  ];
  const tiles = stats.map(([label, value, color], index) => {
    const column = index % 2;
    const row = Math.floor(index / 2);
    const x = 820 + column * 170;
    const y = 116 + row * 84;
    return `<g transform="translate(${x} ${y})"><rect width="154" height="68" rx="7" fill="#0D1420" stroke="#273244"/><text x="14" y="24" fill="#708198" font-family="monospace" font-size="11">${label}</text><text x="14" y="53" fill="${color}" font-family="Segoe UI,Arial,sans-serif" font-size="25" font-weight="800">${value}</text></g>`;
  }).join("");

  const topLanguages = [...data.languages.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  const totalLanguageSize = topLanguages.reduce((sum, [, item]) => sum + item.size, 0) || 1;
  let offset = 0;
  const segments = topLanguages.map(([name, item]) => {
    const width = (item.size / totalLanguageSize) * 1070;
    const segment = `<rect x="${65 + offset}" y="445" width="${Math.max(width, 2).toFixed(1)}" height="12" fill="${item.color || languageColors[name] || "#64748B"}"/>`;
    offset += width;
    return segment;
  }).join("");
  const legend = topLanguages.map(([name, item], index) => {
    const x = 65 + index * 178;
    const percentage = ((item.size / totalLanguageSize) * 100).toFixed(1);
    return `<g transform="translate(${x} 480)"><circle cx="5" cy="-4" r="5" fill="${item.color || languageColors[name] || "#64748B"}"/><text x="16" fill="#AAB6C5" font-family="monospace" font-size="11">${escapeXml(name)} ${percentage}%</text></g>`;
  }).join("");

  const generated = new Date().toISOString().slice(0, 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520" role="img" aria-label="${escapeXml(username)} GitHub telemetry dashboard">
  <defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="#070C14"/><stop offset=".72" stop-color="#0B1220"/><stop offset="1" stop-color="#172554"/></linearGradient><pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#263244" stroke-width=".7" opacity=".23"/></pattern></defs>
  <path d="M0 18 18 0h1164l18 18v484l-18 18H18L0 502Z" fill="url(#bg)"/>
  <path d="M0 18 18 0h1164l18 18v484l-18 18H18L0 502Z" fill="url(#grid)"/>
  <path d="M28 28h310" stroke="#F5B02E" stroke-width="2"/><text x="38" y="62" fill="#F5B02E" font-family="Segoe UI,Arial,sans-serif" font-size="25" font-weight="800">RABBIT TELEMETRY</text><text x="38" y="86" fill="#708198" font-family="monospace" font-size="12">GITHUB ACTIVITY // SELF-COMPILED PROFILE SIGNALS</text>
  <circle cx="1017" cy="53" r="5" fill="#39D353"/><text x="1030" y="58" fill="#AAB6C5" font-family="monospace" font-size="12">LIVE · ${generated}</text>
  <rect x="36" y="108" width="742" height="292" rx="9" fill="#090F19" stroke="#273244"/>
  <text x="60" y="137" fill="#38BDF8" font-family="monospace" font-size="13" font-weight="700">CONTRIBUTION SIGNAL // 53 WEEKS</text>
  <text x="46" y="179" fill="#64748B" font-family="monospace" font-size="10">MON</text><text x="46" y="205" fill="#64748B" font-family="monospace" font-size="10">WED</text><text x="46" y="231" fill="#64748B" font-family="monospace" font-size="10">FRI</text>
  ${cells}
  <text x="60" y="376" fill="#64748B" font-family="monospace" font-size="11">LOW</text>${heat.map((color, index) => `<rect x="92" y="367" width="10" height="10" rx="2" fill="${color}" transform="translate(${index * 13} 0)"/>`).join("")}<text x="164" y="376" fill="#64748B" font-family="monospace" font-size="11">HIGH</text>
  <rect x="800" y="108" width="364" height="292" rx="9" fill="#090F19" stroke="#273244"/><text x="820" y="137" fill="#38BDF8" font-family="monospace" font-size="13" font-weight="700">REPOSITORY VITALS</text>${tiles}
  <rect x="36" y="418" width="1128" height="82" rx="9" fill="#090F19" stroke="#273244"/><text x="60" y="438" fill="#38BDF8" font-family="monospace" font-size="12" font-weight="700">LANGUAGE DISTRIBUTION // BY REPOSITORY BYTES</text><clipPath id="bar"><rect x="65" y="445" width="1070" height="12" rx="6"/></clipPath><g clip-path="url(#bar)">${segments}</g>${legend}
  </svg>`;
}

export async function generateTelemetrySvg() {
  let snapshot;
  try {
    snapshot = await graphqlSnapshot();
  } catch (error) {
    console.warn(`GraphQL snapshot unavailable: ${error.message}`);
  }
  if (!snapshot) snapshot = await publicSnapshot();
  return buildSvg(snapshot);
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedAsScript) {
  const svg = await generateTelemetrySvg();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, svg, "utf8");
  console.log(`Generated ${output} for ${username}`);
}
