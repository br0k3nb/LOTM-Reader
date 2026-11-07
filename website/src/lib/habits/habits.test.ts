// Habit engine and sync tests. Run with `npm run test:habits`.
// `--write-vectors` regenerates habit-sync-vectors.json, which the Android
// app's test/habit_sync_test.dart replays to prove both merges agree.
import { writeFileSync } from "node:fs";
import { HabitEngine, freshHabits, validateHabits } from "./engine";
import { applyDelta, diffDocs, freshDoc, fromDoc, isEmptyDelta, parseDelta, rebase, toDoc, validateDoc, type HabitDelta, type HabitDoc } from "./sync";
import { levelForXp, sequenceForLevel } from "./constants";

let failures = 0;
let passed = 0;
const results: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (error) {
    failures++;
    results.push(`FAIL ${name}: ${error instanceof Error ? error.stack : error}`);
  }
}

function eq(actual: unknown, expected: unknown, label = ""): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label} expected ${e} but got ${a}`);
}

function ok(value: unknown, label = "assertion"): void {
  if (!value) throw new Error(`${label} failed`);
}

const at = (day: string, time = "12:00:00") => new Date(`${day}T${time}`);
const NOW = at("2026-11-07");

/** Reads `pages` new logical pages of a chapter at `when`. */
function read(engine: HabitEngine, when: Date, slug: number, pages: number, edition = "lotm/webnovel", ratio = 0.5) {
  const key = `${edition}/${slug}/${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
  const floor = engine.data.floors[key] ?? -1;
  engine.recordReading({ edition, slug, scroll: (floor + pages) * 800, ratio, now: when });
}

// ---------------------------------------------------------------- engine

check("pages earn XP once per day and chapter", () => {
  const e = new HabitEngine();
  e.recordReading({ edition: "lotm/webnovel", slug: 1, scroll: 0, ratio: 0, now: NOW });
  eq(e.data.totalPages, 1, "first page");
  eq(e.data.totalXp, 2, "first page xp");
  e.recordReading({ edition: "lotm/webnovel", slug: 1, scroll: 4000, ratio: 0.4, now: NOW });
  eq(e.data.totalPages, 6, "pages");
  e.recordReading({ edition: "lotm/webnovel", slug: 1, scroll: 2000, ratio: 0.2, now: NOW });
  eq(e.data.totalPages, 6, "scrolling back adds nothing");
  ok(!e.recordReading({ edition: "lotm/unknown", slug: 1, scroll: 9000, now: NOW }), "unknown edition ignored");
});

check("finishing a chapter pays 25 XP once", () => {
  const e = new HabitEngine();
  e.recordReading({ edition: "coi/webnovel", slug: 3, scroll: 0, ratio: 0.96, now: NOW });
  eq(e.data.totalChapters, 1);
  eq(e.data.totalXp, 27);
  e.recordReading({ edition: "coi/webnovel", slug: 3, scroll: 0, ratio: 1, now: at("2026-11-07", "12:01:00") });
  eq(e.data.totalChapters, 1, "second completion");
});

check("goal, quests and celebrations", () => {
  const e = new HabitEngine();
  read(e, NOW, 1, 30);
  const events = e.consumeCelebrations();
  ok(events.includes("goal"), "goal celebrated");
  ok(events.includes("streak-extended:1"), "streak started");
  eq(e.data.goalDays, 1);
  eq(e.data.goalDates, ["2026-11-07"]);
  read(e, at("2026-11-07", "12:01:00"), 2, 30);
  eq(e.data.goalDays, 1, "goal counted once");
});

check("freeze bridges one missed day; streak counts active days", () => {
  const e = new HabitEngine();
  read(e, at("2026-11-04"), 1, 3);
  read(e, at("2026-11-05"), 2, 3);
  read(e, at("2026-11-07"), 3, 3);
  eq(e.data.freezeDates, ["2026-11-06"]);
  eq(e.data.freezes, 0);
  eq(e.currentStreak(NOW), 3);
});

check("rescue offered when the gap exceeds the bank, repaired at 2x goal", () => {
  const e = new HabitEngine();
  e.data.freezes = 0;
  read(e, at("2026-11-02"), 1, 3);
  read(e, at("2026-11-03"), 2, 3);
  read(e, at("2026-11-07"), 3, 1);
  const rescue = e.streakRescue(NOW);
  ok(rescue, "rescue open");
  eq(rescue!.gap, ["2026-11-04", "2026-11-05", "2026-11-06"]);
  eq(e.currentStreak(NOW), 1);
  read(e, at("2026-11-07", "12:02:00"), 4, 60);
  eq(e.data.repairs, 1);
  eq(e.currentStreak(NOW), 3);
});

check("level and sequence math", () => {
  eq(levelForXp(0).level, 1);
  eq(levelForXp(100).level, 2);
  eq(levelForXp(250).level, 3);
  eq(sequenceForLevel(levelForXp(0)).name, "Seer");
  eq(sequenceForLevel(levelForXp(100 + 150 + 200)).name, "Clown");
});

check("chest and weekly rewards", () => {
  const e = new HabitEngine();
  ok(!e.chestAvailable(NOW), "locked before goal");
  read(e, NOW, 1, 30);
  ok(e.chestAvailable(NOW), "unlocked");
  const reward = e.openChest(NOW);
  ok(reward, "opened");
  eq(e.data.chestReward, { on: "2026-11-07", xp: reward!.xp, freeze: reward!.freeze });
  ok(!e.chestAvailable(NOW), "once per day");
  const w = e.weeklyChallenge(NOW);
  eq(w.week, "2026-11-02");
  eq(w.targets, [150, 250, 350]);
});

check("validation keeps app fields and drops junk", () => {
  const data = validateHabits({ ...freshHabits(), totalXp: -4, goal: "bogus", achievements: ["first-page", "nope"], goalUpdatedAt: 5 });
  eq(data.totalXp, 0);
  eq(data.goal, "regular");
  eq(data.achievements, ["first-page"]);
  eq(data.goalUpdatedAt, 5);
});

// ---------------------------------------------------------------- sync

type Device = { engine: HabitEngine; base: HabitDoc };

function device(): Device {
  return { engine: new HabitEngine(), base: freshDoc() };
}

/** One full client round against an in-memory server. */
function syncDevice(d: Device, server: { doc: HabitDoc }, when: Date): void {
  const snapshot = toDoc(d.engine.data, when);
  const delta = diffDocs(snapshot, d.base);
  if (!isEmptyDelta(delta)) server.doc = applyDelta(server.doc, delta, when);
  const merged = rebase(server.doc, toDoc(d.engine.data, when), snapshot, when);
  d.engine.data = fromDoc(merged, d.engine.data);
  d.base = server.doc;
  d.engine.reconcile(when);
  d.engine.consumeCelebrations();
}

check("empty diff", () => {
  ok(isEmptyDelta(diffDocs(freshDoc(), freshDoc())), "fresh vs fresh");
});

check("two devices reading the same day add up and converge", () => {
  const server = { doc: freshDoc() };
  const phone = device();
  const web = device();
  read(phone.engine, at("2026-11-07", "08:00:00"), 1, 10);
  read(web.engine, at("2026-11-07", "21:00:00"), 2, 12, "lotm/webnovel", 0.97);
  syncDevice(phone, server, NOW);
  syncDevice(web, server, NOW);
  syncDevice(phone, server, NOW);
  eq(server.doc.totalPages, 22, "pages");
  eq(server.doc.days["2026-11-07"].pages, 22, "day pages");
  eq(server.doc.totalChapters, 1, "chapters");
  eq(phone.engine.data.totalXp, web.engine.data.totalXp, "converged xp");
  eq(toDoc(phone.engine.data, NOW), toDoc(web.engine.data, NOW), "converged docs");
});

check("goal met on both devices offline is counted once", () => {
  const server = { doc: freshDoc() };
  const phone = device();
  const web = device();
  read(phone.engine, NOW, 1, 30);
  read(web.engine, NOW, 2, 30);
  syncDevice(phone, server, NOW);
  syncDevice(web, server, NOW);
  eq(server.doc.goalDays, 1);
  eq(server.doc.goalDates, ["2026-11-07"]);
});

check("a freeze spent on the same day by two devices is refunded", () => {
  const server = { doc: freshDoc() };
  const phone = device();
  read(phone.engine, at("2026-11-05"), 1, 3);
  syncDevice(phone, server, at("2026-11-05"));
  const web = device();
  syncDevice(web, server, at("2026-11-05"));
  read(phone.engine, NOW, 2, 3);
  read(web.engine, NOW, 3, 3);
  eq(phone.engine.data.freezeDates, ["2026-11-06"]);
  eq(web.engine.data.freezeDates, ["2026-11-06"]);
  syncDevice(phone, server, NOW);
  syncDevice(web, server, NOW);
  eq(server.doc.freezes, 0, "one freeze spent");
  eq(server.doc.freezesUsed, 1, "used once");
});

check("chest opened on two devices is refunded", () => {
  const server = { doc: freshDoc() };
  const phone = device();
  const web = device();
  read(phone.engine, NOW, 1, 30);
  read(web.engine, NOW, 2, 30);
  const reward = phone.engine.openChest(NOW)!;
  web.engine.openChest(NOW);
  syncDevice(phone, server, NOW);
  const afterPhone = server.doc.totalXp;
  syncDevice(web, server, NOW);
  eq(server.doc.chestsOpened, 1);
  eq(server.doc.rewardXp, reward.xp);
  ok(server.doc.totalXp >= afterPhone, "reading XP kept");
});

check("changes made during a request are replayed on top", () => {
  const server = { doc: freshDoc() };
  const d = device();
  read(d.engine, NOW, 1, 5);
  const snapshot = toDoc(d.engine.data, NOW);
  server.doc = applyDelta(server.doc, diffDocs(snapshot, d.base), NOW);
  read(d.engine, at("2026-11-07", "12:01:00"), 1, 4); // while in flight
  const merged = rebase(server.doc, toDoc(d.engine.data, NOW), snapshot, NOW);
  eq(merged.totalPages, 9);
  d.base = server.doc;
  d.engine.data = fromDoc(merged, d.engine.data);
  const next = diffDocs(toDoc(d.engine.data, NOW), d.base);
  eq(next.add?.totalPages, 4, "only the new pages go up next");
});

check("goal setting is last-writer-wins", () => {
  const doc = freshDoc();
  const a = applyDelta(doc, { goal: { value: "intense", at: 200 } }, NOW);
  const b = applyDelta(a, { goal: { value: "casual", at: 100 } }, NOW);
  eq(b.goal, "intense");
});

check("delta parser rejects junk", () => {
  ok(parseDelta({ add: { totalXp: 5 } }), "valid");
  ok(!parseDelta({ add: { hacked: 5 } }), "unknown counter");
  ok(!parseDelta({ days: { "2026-13-01": { pages: 1 } } }), "bad date");
  ok(!parseDelta({ sets: { achievements: ["made-up"] } }), "unknown badge");
  ok(!parseDelta({ extra: 1 }), "unknown field");
});

// ---------------------------------------------------------------- vectors

type Vector = { name: string; now: string; doc: HabitDoc; delta: HabitDelta; expected: HabitDoc };

function vectors(): { apply: Vector[]; diff: { name: string; local: HabitDoc; base: HabitDoc; expected: HabitDelta }[]; quests: Record<string, string[]>; chests: Record<string, unknown> } {
  const now = NOW;
  const phone = new HabitEngine();
  read(phone, at("2026-11-04"), 1, 3);
  read(phone, at("2026-11-05"), 2, 40, "lotm/webnovel", 0.99);
  read(phone, at("2026-11-07", "06:30:00"), 3, 30, "coi/pt-br", 0.96);
  phone.openChest(now);
  phone.setGoal("serious", 1_762_500_000_000);
  const phoneDoc = toDoc(phone.data, now);

  const web = new HabitEngine();
  read(web, at("2026-11-05"), 9, 12);
  read(web, at("2026-11-07", "23:30:00"), 3, 30, "coi/pt-br", 0.96);
  web.openChest(at("2026-11-07", "23:31:00"));
  const webDoc = toDoc(web.data, now);

  const server = applyDelta(freshDoc(), diffDocs(phoneDoc, freshDoc()), now);
  const cases: [string, HabitDoc, HabitDelta][] = [
    ["first upload", freshDoc(), diffDocs(phoneDoc, freshDoc())],
    ["second device with duplicates", server, diffDocs(webDoc, freshDoc())],
    ["refund weekly duplicate", { ...server, weekClaims: { "2026-11-02": [0] } }, { weekClaims: { "2026-11-02": [0, 1] }, add: { weeklyClaims: 2, rewardXp: 60, totalXp: 60 } }],
    ["freeze milestone duplicate", { ...server, freezeMilestones: [10], freezes: 2 }, { freezeMilestones: [10, 20], add: { freezes: 2 } }],
    ["quest bonus duplicate", applyDelta(freshDoc(), { days: { "2026-11-07": { pages: 30, xp: 75, quests: true } }, add: { questDays: 1, totalXp: 75 } }, now), { days: { "2026-11-07": { pages: 10, xp: 35, quests: true } }, add: { questDays: 1, totalXp: 35 } }],
    ["older goal loses", { ...server, goal: "serious", goalUpdatedAt: 500 }, { goal: { value: "casual", at: 400 } }],
    ["retention and floors window", freshDoc(), { days: { "2025-01-01": { pages: 5, xp: 10 }, "2026-11-01": { pages: 1, xp: 2 } }, floors: { "lotm/webnovel/5/2026-10-20": 3, "lotm/webnovel/5/2026-11-06": 7 }, add: { totalPages: 6, totalXp: 12 } }],
  ];
  const quests: Record<string, string[]> = {};
  const chests: Record<string, unknown> = {};
  const probe = new HabitEngine();
  for (let i = 0; i < 30; i++) {
    const day = new Date(2026, 10, 1 + i);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    quests[key] = probe.questsFor(key).map((q) => `${q.id}:${q.target}`);
    chests[key] = probe.chestFor(key);
  }
  return {
    apply: cases.map(([name, doc, delta]) => ({ name, now: "2026-11-07T12:00:00", doc, delta, expected: applyDelta(doc, delta, now) })),
    diff: [
      { name: "phone history", local: phoneDoc, base: freshDoc(), expected: diffDocs(phoneDoc, freshDoc()) },
      { name: "web since server", local: fromDocToDoc(server, webDoc), base: server, expected: diffDocs(fromDocToDoc(server, webDoc), server) },
    ],
    quests,
    chests,
  };
}

function fromDocToDoc(base: HabitDoc, extra: HabitDoc): HabitDoc {
  return applyDelta(base, diffDocs(extra, freshDoc()), NOW);
}

export async function run(options: { writeVectors: boolean; vectorsPath: string }): Promise<number> {
  const generated = vectors();
  check("vectors are self-consistent", () => {
    for (const v of generated.apply) eq(applyDelta(v.doc, v.delta, new Date(v.now)), v.expected, v.name);
    for (const v of generated.apply) eq(validateDoc(JSON.parse(JSON.stringify(v.expected)), new Date(v.now)), v.expected, `${v.name} round trip`);
  });
  if (options.writeVectors) {
    writeFileSync(options.vectorsPath, `${JSON.stringify(generated, null, 2)}\n`);
    results.push(`wrote ${options.vectorsPath}`);
  } else {
    try {
      const { readFileSync } = await import("node:fs");
      const stored = JSON.parse(readFileSync(options.vectorsPath, "utf8"));
      eq(stored, JSON.parse(JSON.stringify(generated)), "habit-sync-vectors.json (run with --write-vectors)");
      passed++;
    } catch (error) {
      failures++;
      results.push(`FAIL vectors: ${error instanceof Error ? error.message.slice(0, 300) : error}`);
    }
  }
  for (const line of results) console.log(line);
  console.log(`${passed} passed, ${failures} failed`);
  return failures;
}
