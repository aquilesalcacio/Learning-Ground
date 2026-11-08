// Run from web/: node --test lib/lg-presets.test.ts
// Node strips the types itself, so this needs no test framework.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogVoice } from "./lg-voices";
import type { Tutor } from "./lg-types";

// Node needs the extension and TypeScript rejects it in a static import, so it's loaded here.
const presets = (await import(`./lg-presets${".ts"}`)) as typeof import("./lg-presets");
const { DEFAULT_TUTOR_ID, migrateLgState, PRESET_TUTORS, PRESETS_VERSION } = presets;
const catalog = (await import("./voice-catalog.json", { with: { type: "json" } })).default as Record<
  string,
  CatalogVoice[]
>;

// The starter tutors as they were saved before version 2.
function oldPreset(id: string, name: string, color: Tutor["color"], language: Tutor["language"], tone: Tutor["tone"]): Tutor {
  return { id, name, color, language, tone, voice_id: "", style: "", persona_prompt: "", is_preset: true };
}
const oldTutors = (): Tutor[] => [
  oldPreset("prof-ana", "Prof. Ana", "blue", "pt", "casual"),
  oldPreset("don-mateo", "Don Mateo", "red", "es", "formal"),
  oldPreset("sam", "Sam", "green", "en", "humorous"),
];
const studentTutor: Tutor = {
  id: "c0ffee",
  name: "Coach Bia",
  color: "violet",
  voice_id: "",
  language: "pt",
  tone: "formal",
  style: "socratic",
  persona_prompt: "Loves soccer.",
  is_preset: false,
};
const oldSave = () => ({
  tutors: [...oldTutors(), studentTutor],
  active_tutor_id: "prof-ana",
  active_conversation_id: "chat-1",
  draft_id: "draft-1",
  conversations: [{ id: "chat-1", tutor_id: "prof-ana" }],
});

const byId = (tutors: Tutor[], id: string) => tutors.find((tutor) => tutor.id === id);

test("a fresh browser starts on Prof. Sam, listed first", () => {
  assert.equal(DEFAULT_TUTOR_ID, "sam");
  assert.deepEqual(
    PRESET_TUTORS.map(({ id, name, language }) => [id, name, language]),
    [
      ["sam", "Prof. Sam", "en"],
      ["prof-ana", "Prof. Luisa", "pt"],
      ["don-mateo", "Prof. Erik", "es"],
    ],
  );
  assert.ok(PRESET_TUTORS.every((tutor) => tutor.is_preset));
  assert.equal(PRESETS_VERSION, 2);
});

test("every preset voice is in the catalog for its language, and Prof. Luisa's is female", () => {
  for (const tutor of PRESET_TUTORS) {
    const voice = catalog[tutor.language].find((item) => item.voice_id === tutor.voice_id);
    assert.ok(voice, `${tutor.name}'s voice ${tutor.voice_id} isn't in the ${tutor.language} catalog`);
  }
  const luisa = byId([...PRESET_TUTORS], "prof-ana")!;
  assert.equal(catalog.pt.find((voice) => voice.voice_id === luisa.voice_id)?.gender, "female");
});

test("an old save gets the new names and voices, with Sam first", () => {
  const migrated = migrateLgState(oldSave());
  assert.equal(migrated.presets_version, PRESETS_VERSION);
  assert.deepEqual(
    migrated.tutors.map(({ id, name }) => [id, name]),
    [
      ["sam", "Prof. Sam"],
      ["prof-ana", "Prof. Luisa"],
      ["don-mateo", "Prof. Erik"],
      ["c0ffee", "Coach Bia"],
    ],
  );
  for (const preset of PRESET_TUTORS) assert.equal(byId(migrated.tutors, preset.id)?.voice_id, preset.voice_id);
  // Everything else the student saved comes through.
  assert.equal(migrated.draft_id, "draft-1");
  assert.deepEqual(migrated.conversations, [{ id: "chat-1", tutor_id: "prof-ana" }]);
});

test("an old save opens on Sam with the chat closed, so no Portuguese chat continues as Sam", () => {
  const migrated = migrateLgState(oldSave());
  assert.equal(migrated.active_tutor_id, "sam");
  assert.equal(migrated.active_conversation_id, null);
});

test("a preset the student renamed keeps its name, and a chosen voice stays", () => {
  const save = oldSave();
  save.tutors[0] = { ...save.tutors[0], name: "Tia Ana", voice_id: "u4sbCzXyUVxIAihOtCss" };
  const migrated = migrateLgState(save);
  const ana = byId(migrated.tutors, "prof-ana")!;
  assert.equal(ana.name, "Tia Ana");
  assert.equal(ana.voice_id, "u4sbCzXyUVxIAihOtCss");
  // The others still move to the new defaults.
  assert.equal(byId(migrated.tutors, "sam")?.name, "Prof. Sam");
});

test("a preset the student moved to another language doesn't get the old language's voice", () => {
  const save = oldSave();
  save.tutors[0] = { ...save.tutors[0], language: "es" };
  const ana = byId(migrateLgState(save).tutors, "prof-ana")!;
  assert.equal(ana.voice_id, "");
  assert.equal(ana.name, "Prof. Luisa");
});

test("a tutor the student made is untouched", () => {
  const migrated = migrateLgState(oldSave());
  assert.equal(byId(migrated.tutors, "c0ffee"), studentTutor);
});

test("a student tutor that shares an old preset name isn't renamed", () => {
  const save = oldSave();
  const namesake = { ...studentTutor, id: "beef", name: "Sam" };
  save.tutors.push(namesake);
  assert.equal(byId(migrateLgState(save).tutors, "beef"), namesake);
});

test("a save missing Sam gets Sam back, so the active tutor exists", () => {
  const save = oldSave();
  save.tutors = save.tutors.filter((tutor) => tutor.id !== "sam");
  const migrated = migrateLgState(save);
  assert.equal(migrated.tutors[0].id, "sam");
  assert.equal(migrated.tutors[0].name, "Prof. Sam");
});

test("an already-migrated save is left alone", () => {
  const save = {
    ...oldSave(),
    presets_version: PRESETS_VERSION,
    active_tutor_id: "prof-ana",
    tutors: [oldPreset("prof-ana", "Prof. Ana", "blue", "pt", "casual")],
  };
  assert.equal(migrateLgState(save), save);
  assert.equal(save.active_tutor_id, "prof-ana");
  assert.equal(save.tutors[0].name, "Prof. Ana");
});

test("migrating doesn't change the save it was given", () => {
  const save = oldSave();
  const before = structuredClone(save);
  migrateLgState(save);
  assert.deepEqual(save, before);
});

test("a save with no tutors still gets the version, so the defaults fill in", () => {
  const migrated = migrateLgState({ draft_id: "draft-1" } as { draft_id: string; tutors?: Tutor[] });
  assert.equal(migrated.presets_version, PRESETS_VERSION);
  assert.equal(migrated.active_tutor_id, "sam");
  assert.equal(migrated.tutors, undefined);
});

test("anything that isn't a saved object comes back as it was", () => {
  assert.equal(migrateLgState(null), null);
  assert.equal(migrateLgState(5), 5);
  assert.equal(migrateLgState("x"), "x");
});
