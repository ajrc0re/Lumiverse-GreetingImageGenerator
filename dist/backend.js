// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
var __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res);

// src/types.ts
var IDENTIFIER = "lumiverse_greeting_image_generator", REQUIRED, DEFAULT_SETTINGS;
var init_types = __esm(() => {
  REQUIRED = ["characters", "chats", "images", "image_gen"];
  DEFAULT_SETTINGS = {
    connectionId: "",
    model: "",
    presetId: "",
    instructions: "",
    host: "local",
    placement: "end",
    review: false,
    reviewPrompt: false,
    negativePrompt: "",
    parameters: {}
  };
});

// src/core.ts
var exports_core = {};
__export(exports_core, {
  greetingPatch: () => greetingPatch,
  greetings: () => greetings,
  imageOccurrences: () => imageOccurrences,
  insertImage: () => insertImage,
  referenceParts: () => referenceParts,
  removeOccurrence: () => removeOccurrence,
  resolveImage: () => resolveImage,
  settingsFrom: () => settingsFrom,
  supportsReference: () => supportsReference,
  targetIndex: () => targetIndex
});
function settingsFrom(value) {
  const v = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(["connectionId", "model", "presetId", "instructions", "negativePrompt"].map((k) => [k, typeof v[k] === "string" ? v[k] : ""])),
    host: ["local", "catbox-anon", "catbox-auth"].includes(v.host ?? "") ? v.host : "local",
    placement: v.placement === "start" ? "start" : "end",
    review: v.review === true,
    reviewPrompt: v.reviewPrompt === true,
    parameters: Object.fromEntries(Object.entries(v.parameters ?? {}).filter(([k, x]) => ["width", "height", "resolution", "aspectRatio", "aspect_ratio", "imageSize", "size", "seed"].includes(k) && (typeof x === "string" || typeof x === "number" && Number.isFinite(x))))
  };
}
function maskCode(text) {
  let masked = text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[^\n]*(?:\n|$)|(?![\s\S]))/gm, (s) => " ".repeat(s.length)).replace(/<!--[\s\S]*?(?:-->|$)/g, (s) => " ".repeat(s.length)).replace(/^(?: {4}|\t).*/gm, (s) => " ".repeat(s.length));
  for (let i = 0;i < masked.length; i++) {
    if (masked[i] !== "`" || masked[i - 1] === "\\")
      continue;
    let end = i;
    while (masked[end] === "`")
      end++;
    const delimiter = masked.slice(i, end);
    let close = masked.indexOf(delimiter, end);
    while (close !== -1 && (masked[close - 1] === "`" || masked[close + delimiter.length] === "`"))
      close = masked.indexOf(delimiter, close + delimiter.length);
    if (close !== -1) {
      const after = close + delimiter.length;
      masked = masked.slice(0, i) + " ".repeat(after - i) + masked.slice(after);
      i = after - 1;
    } else
      i = end - 1;
  }
  return masked;
}
function unescape(s) {
  return s.replace(/\\([\\()[\]<>])/g, "$1").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
}
function imageOccurrences(text) {
  const masked = maskCode(text);
  const result = [];
  const add = (start, end, source, alt = "") => result.push({ start, end, source: unescape(source), alt: unescape(alt), markup: text.slice(start, end) });
  const html = /<img\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  for (const match of masked.matchAll(html)) {
    const tag = match[0];
    const risu = /^<img\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const attributes = new Map;
    for (const attr of tag.slice(4, -1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
      attributes.set(attr[1].toLowerCase(), attr[2] ?? attr[3] ?? attr[4] ?? "");
    const src = risu ? risu[1] ?? risu[2] ?? risu[3] : attributes.get("src");
    if (src)
      add(match.index, match.index + tag.length, src, attributes.get("alt") ?? "");
  }
  const definitions = new Map;
  for (const m of masked.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm))
    definitions.set(m[1].trim().toLowerCase(), m[2] ?? m[3]);
  for (let i = 0;i < masked.length - 3; i++) {
    if (masked.slice(i, i + 2) !== "![" || i > 0 && masked[i - 1] === "\\" || result.some((r) => i >= r.start && i < r.end))
      continue;
    let p = i + 2, depth = 1;
    for (;p < masked.length; p++) {
      if (masked[p] === "\\") {
        p++;
        continue;
      }
      if (masked[p] === "[")
        depth++;
      if (masked[p] === "]") {
        depth--;
        if (depth === 0)
          break;
      }
    }
    if (p >= masked.length)
      continue;
    const alt = text.slice(i + 2, p);
    let q = p + 1;
    if (masked[q] === "(") {
      q++;
      while (/\s/.test(masked[q] ?? "") && q < masked.length)
        q++;
      const begin = q;
      let source = "";
      if (masked[q] === "<") {
        const end = masked.indexOf(">", q + 1);
        if (end < 0)
          continue;
        source = text.slice(q + 1, end);
        q = end + 1;
      } else {
        let nesting = 0;
        for (;q < masked.length; q++) {
          if (masked[q] === "\\") {
            q++;
            continue;
          }
          if (masked[q] === "(")
            nesting++;
          if (masked[q] === ")") {
            if (!nesting)
              break;
            nesting--;
          }
          if (/\s/.test(masked[q]) && !nesting)
            break;
        }
        source = text.slice(begin, q);
      }
      while (/\s/.test(masked[q] ?? "") && q < masked.length)
        q++;
      if (masked[q] === '"' || masked[q] === "'") {
        const quote = masked[q++];
        while (q < masked.length && masked[q] !== quote) {
          if (masked[q] === "\\")
            q++;
          q++;
        }
        q++;
        while (/\s/.test(masked[q] ?? "") && q < masked.length)
          q++;
      }
      if (masked[q] === ")" && source) {
        add(i, q + 1, source, alt);
        i = q;
      }
    } else if (masked[q] === "[") {
      const end = masked.indexOf("]", q + 1);
      if (end < 0)
        continue;
      const source = definitions.get((text.slice(q + 1, end) || alt).trim().toLowerCase());
      if (source) {
        add(i, end + 1, source, alt);
        i = end;
      }
    } else {
      const source = definitions.get(alt.trim().toLowerCase());
      if (source) {
        add(i, p + 1, source, alt);
        i = p;
      }
    }
  }
  return result.sort((a, b) => a.start - b.start);
}
function greetings(character) {
  const tools = character.extensions?.greeting_tools;
  return [character.first_mes, ...character.alternate_greetings].map((text, index) => {
    const metadata = index === 0 ? tools?.mainGreeting : tools?.greetings?.[tools?.indexMap?.[String(index - 1)]];
    const title = typeof metadata?.title === "string" ? metadata.title.trim() : "";
    return { index, text, title: title || (index === 0 ? "Main greeting" : `Greeting ${index + 1}`), images: imageOccurrences(text) };
  });
}
function resolveImage(source, character) {
  const map = character.extensions?.risu_asset_map ?? {};
  const clean = source.replace(/^embeded:\/\//, "");
  const stem = clean.split("/").pop()?.replace(/\.[^.]*$/, "") ?? clean;
  const imageId = map[source] || map[clean] || map[stem];
  if (typeof imageId === "string")
    return { imageId, url: `/api/v1/images/${encodeURIComponent(imageId)}` };
  const local = /^\/api\/v1\/(?:images|image-gen\/results)\/([^/?#]+)/.exec(source);
  if (local) {
    try {
      return { imageId: decodeURIComponent(local[1]), url: source };
    } catch {
      return {};
    }
  }
  return /^(https?:\/\/|\/(?!\/)|data:image\/(?:png|jpeg|webp|gif|avif);base64,)/i.test(source) ? { url: source } : {};
}
function insertImage(text, url, title, position) {
  if (!/^(https?:\/\/|\/api\/v1\/)/i.test(url) || /[\s<>]/.test(url))
    throw new Error("Unsupported image URL");
  const alt = title.replace(/[\\\[\]\r\n]/g, " ").trim();
  const markup = `![${alt}](<${url}>)`;
  return !text ? markup : position === "start" ? `${markup}

${text}` : `${text}

${markup}`;
}
function removeOccurrence(text, occurrence) {
  const exact = imageOccurrences(text).find((x) => x.start === occurrence.start && x.end === occurrence.end && x.markup === occurrence.markup);
  if (!exact)
    throw new Error("Greeting changed. Refresh before removing this image.");
  return text.slice(0, exact.start) + text.slice(exact.end);
}
function targetIndex(character, index, original) {
  const all = greetings(character);
  if (all[index]?.text === original)
    return index;
  throw new Error("Greeting changed or moved. The image is retained; choose Apply to a current greeting.");
}
function greetingPatch(character, index, text) {
  if (index === 0)
    return { first_mes: text };
  const alternate_greetings = [...character.alternate_greetings];
  alternate_greetings[index - 1] = text;
  return { alternate_greetings };
}
function referenceParts(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
  if (!match)
    throw new Error("Use a PNG, JPEG, WebP, or GIF image");
  if (match[2].length > 28000000)
    throw new Error("Image must be smaller than 20 MB");
  return { mimeType: match[1], data: match[2] };
}
var supportsReference = (provider) => ["openai", "google_gemini", "openrouter"].includes(provider);
var init_core = __esm(() => {
  init_types();
});

// src/catbox.ts
init_core();
var ENDPOINT = "https://catbox.moe/user/api.php";
function catboxFilename(url) {
  const parsed = new URL(url);
  if (parsed.origin !== "https://files.catbox.moe" || !/^\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(parsed.pathname) || parsed.search || parsed.hash)
    throw new Error("Catbox returned an invalid image URL");
  return parsed.pathname.slice(1);
}
async function fingerprint(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, "0")).join("");
}
async function uploadCatbox(dataUrl, secret, transport = fetch) {
  const { mimeType, data } = referenceParts(dataUrl);
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const form = new FormData;
  form.set("reqtype", "fileupload");
  if (secret)
    form.set("userhash", secret);
  form.set("fileToUpload", new Blob([bytes], { type: mimeType }), `greeting.${mimeType.split("/")[1]}`);
  const response = await transport(ENDPOINT, { method: "POST", body: form, signal: AbortSignal.timeout(120000) });
  if (!response.ok)
    throw new Error(`Catbox upload failed (HTTP ${response.status}). Your local image is retained.`);
  const url = (await response.text()).trim();
  catboxFilename(url);
  return url;
}
async function deleteCatbox(url, secret, transport = fetch) {
  const body = new URLSearchParams({ reqtype: "deletefiles", userhash: secret, files: catboxFilename(url) });
  const response = await transport(ENDPOINT, { method: "POST", body, signal: AbortSignal.timeout(30000) });
  const reply = (await response.text()).trim();
  if (!response.ok || reply !== "Files successfully deleted.")
    throw new Error("Catbox did not confirm deletion. The greeting edit was saved; the public file may remain.");
}

// src/engine.ts
init_core();
init_types();

class Engine {
  api;
  userId;
  changed;
  data = new Map;
  busy = false;
  stopped = new Set;
  abort;
  transient = new Map;
  writes = Promise.resolve();
  storageWrites = Promise.resolve();
  constructor(api, userId, changed) {
    this.api = api;
    this.userId = userId;
    this.changed = changed;
  }
  path(id) {
    return `characters/${encodeURIComponent(id)}.json`;
  }
  serial(fn) {
    const result = this.writes.then(fn, fn);
    this.writes = result.catch(() => {});
    return result;
  }
  async load(id) {
    if (!this.data.has(id)) {
      const saved = await this.api.userStorage.getJson(this.path(id), { fallback: { guide: { style: "" }, jobs: [] }, userId: this.userId });
      for (const job of saved.jobs)
        if (["queued", "preparing", "generating", "uploading", "saving"].includes(job.stage)) {
          job.stage = "stopped";
          job.stopped = true;
          job.error = "Interrupted by an extension restart. Review before retrying; a provider request may have completed.";
        }
      if (!this.data.has(id))
        this.data.set(id, saved);
    }
    return this.data.get(id);
  }
  async persist(id) {
    const value = this.data.get(id);
    const active = value.jobs.filter((j) => ["queued", "preparing", "generating", "uploading", "saving"].includes(j.stage));
    const recent = value.jobs.filter((j) => !active.includes(j)).slice(-50);
    value.jobs = [...active, ...recent].sort((a, b) => a.createdAt - b.createdAt);
    const snapshot = structuredClone(value);
    const write = this.storageWrites.then(() => this.api.userStorage.setJson(this.path(id), snapshot, { userId: this.userId }));
    this.storageWrites = write.catch(() => {});
    await write;
  }
  async stage(job, stage) {
    job.stage = stage;
    await this.persist(job.characterId);
    this.changed(structuredClone(job));
  }
  async settings() {
    return settingsFrom(await this.api.userStorage.getJson("settings.json", { fallback: {}, userId: this.userId }));
  }
  async saveSettings(settings) {
    const value = settingsFrom(settings);
    await this.api.userStorage.setJson("settings.json", value, { userId: this.userId });
    return value;
  }
  async guide(id, guide) {
    return this.serial(async () => {
      const data = await this.load(id);
      data.guide = { style: String(guide.style || ""), referenceId: guide.referenceId || undefined };
      await this.persist(id);
    });
  }
  async create(input) {
    return this.serial(async () => {
      const char = await this.character(input.characterId);
      targetIndex(char, input.index, input.original);
      const job = { ...input, settings: settingsFrom(input.settings), guide: structuredClone(input.guide), id: crypto.randomUUID(), stage: "queued", createdAt: Date.now() };
      const data = await this.load(input.characterId);
      data.jobs.push(job);
      await this.persist(input.characterId);
      return structuredClone(job);
    });
  }
  async find(characterId, id) {
    const job = (await this.load(characterId)).jobs.find((j) => j.id === id);
    if (!job)
      throw new Error("Job is no longer available");
    return job;
  }
  async prepared(characterId, id, prompt) {
    const job = await this.find(characterId, id);
    if (job.imageId || job.generationStarted)
      throw new Error("This image job already started");
    if (!prompt.prompt?.trim())
      throw new Error("The native parser returned an empty prompt");
    job.prompt = { prompt: prompt.prompt.trim(), negativePrompt: prompt.negativePrompt };
    job.error = undefined;
    await this.stage(job, "queued");
    return structuredClone(job);
  }
  async failed(characterId, id, error) {
    const job = await this.find(characterId, id);
    job.error = String(error);
    await this.stage(job, this.stopped.has(id) ? "stopped" : "failed");
  }
  async stop(characterId, ids) {
    for (const id of ids) {
      this.stopped.add(id);
      const job = await this.find(characterId, id);
      job.stopped = true;
      if (!job.inserted)
        await this.stage(job, "stopped");
    }
    this.abort?.abort();
  }
  async run(characterId, id, options = {}) {
    if (this.busy)
      throw new Error("Another image job is running. Wait for it to finish.");
    const job = await this.find(characterId, id);
    if (this.busy)
      throw new Error("Another image job is running. Wait for it to finish.");
    if (job.inserted)
      return structuredClone(job);
    if (job.imageDeleted)
      throw new Error("This image was permanently deleted");
    if (!job.prompt)
      throw new Error("Prepare an image prompt first");
    if (job.generationStarted && !job.imageId && !this.transient.has(id) && !options.retryGeneration)
      throw new Error("The previous request may have completed. Confirm a new generation before retrying.");
    this.busy = true;
    this.stopped.delete(id);
    job.stopped = false;
    job.error = undefined;
    try {
      let dataUrl = this.transient.get(id) || options.imageDataUrl;
      if (!job.imageId && !dataUrl) {
        const connection = await this.api.imageGen.getConnection(job.settings.connectionId, this.userId);
        if (!connection)
          throw new Error("Select an available image connection profile in Settings");
        await this.character(job.characterId);
        if (this.stopped.has(id)) {
          await this.stage(job, "stopped");
          return structuredClone(job);
        }
        const parameters = { ...job.settings.parameters };
        if (job.guide.referenceId && supportsReference(connection.provider)) {
          if (!options.referenceDataUrl)
            throw new Error("The set reference could not be loaded");
          parameters.referenceImages = [referenceParts(options.referenceDataUrl)];
          parameters.resolvedSourceImages = parameters.referenceImages;
        }
        job.generationStarted = true;
        await this.stage(job, "generating");
        const input = { prompt: job.prompt.prompt, negativePrompt: job.settings.negativePrompt || job.prompt.negativePrompt, connection_id: connection.id, model: job.settings.model || undefined, parameters, owner_character_id: job.characterId, includeDataUrl: true, userId: this.userId };
        const providers = await this.api.imageGen.getProviders(this.userId);
        if (this.stopped.has(id)) {
          await this.stage(job, "stopped");
          return structuredClone(job);
        }
        let result;
        if (providers.find((p) => p.id === connection.provider)?.capabilities.websocketPreviewStreaming) {
          this.abort = new AbortController;
          for await (const event of this.api.imageGen.generateStream({ ...input, signal: this.abort.signal })) {
            if (event.type === "preview" && !this.stopped.has(id))
              this.changed(structuredClone(job), event.imageDataUrl);
            if (event.type === "done")
              result = event.result;
          }
        } else
          result = await this.api.imageGen.generate(input);
        if (!result)
          throw new Error("Generation ended without a final image");
        dataUrl = result.imageDataUrl;
        if (dataUrl)
          this.transient.set(id, dataUrl);
        job.imageId = result.imageId;
        job.localUrl = result.imageUrl;
      }
      if (!job.imageId) {
        if (!dataUrl)
          throw new Error("The provider returned no usable image");
        const image = await this.api.images.uploadFromDataUrl(dataUrl, { originalFilename: "greeting.png", owner_character_id: job.characterId, userId: this.userId });
        job.imageId = image.id;
      }
      job.localUrl ||= `/api/v1/image-gen/results/${encodeURIComponent(job.imageId)}`;
      await this.persist(characterId);
      if (this.stopped.has(id)) {
        await this.stage(job, "stopped");
        return structuredClone(job);
      }
      if (job.settings.host !== "local" && !job.publicUrl) {
        if (!dataUrl)
          throw new Error("Local image is safe. Retry upload to load its bytes.");
        await this.stage(job, "uploading");
        const secret = job.settings.host === "catbox-auth" ? await this.api.enclave.get("catbox_userhash", this.userId) : undefined;
        if (job.settings.host === "catbox-auth" && !secret)
          throw new Error("Save your Catbox userhash in Settings; then retry upload");
        const accountFingerprint = secret ? await fingerprint(secret) : undefined;
        job.publicUrl = await uploadCatbox(dataUrl, secret || undefined);
        job.accountFingerprint = accountFingerprint;
        await this.persist(characterId);
      }
      this.transient.delete(id);
      if (this.stopped.has(id))
        await this.stage(job, "stopped");
      else if (job.settings.review)
        await this.stage(job, "review");
      else
        await this.apply(characterId, id);
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      await this.stage(job, this.stopped.has(id) ? "stopped" : "failed");
    } finally {
      this.busy = false;
      this.abort = undefined;
    }
    return structuredClone(job);
  }
  async character(id) {
    const char = await this.api.characters.get(id, this.userId);
    if (!char)
      throw new Error("Character no longer exists");
    return char;
  }
  async apply(characterId, id, explicit) {
    return this.serial(async () => {
      const job = await this.find(characterId, id);
      if (job.imageDeleted)
        throw new Error("This image was permanently deleted");
      if (job.inserted && !explicit)
        return structuredClone(job);
      if (!explicit && this.stopped.has(id)) {
        await this.stage(job, "stopped");
        return structuredClone(job);
      }
      const char = await this.character(characterId);
      const index = explicit?.index ?? job.index;
      const original = explicit?.original ?? job.original;
      targetIndex(char, index, original);
      const url = explicit?.local ? job.localUrl : job.publicUrl || job.localUrl;
      if (!url)
        throw new Error("There is no saved image to insert");
      const after = insertImage(original, url, job.title, job.settings.placement);
      await this.stage(job, "saving");
      if (!explicit && this.stopped.has(id)) {
        await this.stage(job, "stopped");
        return structuredClone(job);
      }
      await this.api.characters.update(characterId, greetingPatch(char, index, after), this.userId);
      const data = await this.load(characterId);
      data.undo = { index, before: original, after };
      job.inserted = true;
      job.stopped = false;
      job.error = undefined;
      await this.stage(job, "complete");
      return structuredClone(job);
    });
  }
  async remove(characterId, index, original, occurrence) {
    return this.serial(async () => {
      const char = await this.character(characterId);
      targetIndex(char, index, original);
      const after = removeOccurrence(original, occurrence);
      await this.api.characters.update(characterId, greetingPatch(char, index, after), this.userId);
      const data = await this.load(characterId);
      data.undo = { index, before: original, after };
      await this.persist(characterId);
      return { ...resolveImage(occurrence.source, char), source: occurrence.source };
    });
  }
  async undo(characterId) {
    return this.serial(async () => {
      const data = await this.load(characterId);
      if (!data.undo)
        throw new Error("Nothing to undo");
      const { index, before, after } = data.undo;
      const char = await this.character(characterId);
      targetIndex(char, index, after);
      await this.api.characters.update(characterId, greetingPatch(char, index, before), this.userId);
      delete data.undo;
      await this.persist(characterId);
    });
  }
  async fileEligibility(characterId, source) {
    const char = await this.character(characterId);
    const resolved = resolveImage(source, char);
    const data = await this.load(characterId);
    const job = [...data.jobs].reverse().find((j) => !j.imageDeleted && (j.publicUrl === source || !!resolved.imageId && j.imageId === resolved.imageId));
    if (!job)
      return { local: false, catbox: false };
    const image = job.imageId ? await this.api.images.get(job.imageId, { onlyOwned: true, userId: this.userId }) : null;
    const secret = await this.api.enclave.get("catbox_userhash", this.userId);
    return {
      local: !!resolved.imageId && data.guide.referenceId !== resolved.imageId && image?.owner_extension_identifier === IDENTIFIER,
      catbox: !!job.publicUrl && source === job.publicUrl && !!secret && job.accountFingerprint === await fingerprint(secret),
      jobId: job.id,
      imageId: resolved.imageId
    };
  }
  async deletePublic(characterId, source) {
    const eligible = await this.fileEligibility(characterId, source);
    if (!eligible.catbox || !eligible.jobId)
      throw new Error("This is not a verified upload owned by the configured Catbox account");
    await deleteCatbox(source, await this.api.enclave.get("catbox_userhash", this.userId));
    const job = await this.find(characterId, eligible.jobId);
    job.publicUrl = undefined;
    const data = await this.load(characterId);
    delete data.undo;
    await this.persist(characterId);
  }
  async deletedLocal(characterId, imageId) {
    const data = await this.load(characterId);
    for (const job of data.jobs)
      if (job.imageId === imageId)
        job.imageDeleted = true;
    if (data.guide.referenceId === imageId)
      delete data.guide.referenceId;
    delete data.undo;
    await this.persist(characterId);
  }
  async attach(input) {
    if (this.busy)
      throw new Error("Wait for the running generation before attaching an image");
    if (input.dataUrl)
      referenceParts(input.dataUrl);
    else if (!["https:", "http:"].includes(new URL(input.url || "").protocol))
      throw new Error("Use an HTTP or HTTPS image URL");
    const job = await this.create({ ...input, chatId: "", guide: { style: "" } });
    const stored = await this.find(input.characterId, job.id);
    if (input.dataUrl) {
      referenceParts(input.dataUrl);
      const image = await this.api.images.uploadFromDataUrl(input.dataUrl, { originalFilename: "greeting-upload.png", owner_character_id: input.characterId, userId: this.userId });
      stored.imageId = image.id;
      stored.localUrl = `/api/v1/image-gen/results/${image.id}`;
    } else {
      const url = new URL(input.url || "");
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error("Use an HTTP or HTTPS image URL");
      stored.publicUrl = url.href;
    }
    await this.persist(input.characterId);
    return this.apply(input.characterId, job.id);
  }
}

// src/backend.ts
init_types();
var engines = new Map;
function engine(userId) {
  const key = userId || "owner";
  if (!engines.has(key))
    engines.set(key, new Engine(spindle, userId, (job, preview) => spindle.sendToFrontend({ type: "gig:event", job, preview }, userId)));
  return engines.get(key);
}
spindle.onFrontendMessage(async (raw, userId) => {
  if (!raw || typeof raw !== "object")
    return;
  const message = raw;
  if (message.type !== "gig:request" || typeof message.requestId !== "string")
    return;
  const reply = (result, error) => spindle.sendToFrontend({ type: "gig:reply", requestId: message.requestId, result, error }, userId);
  try {
    const e = engine(userId), input = message.input ?? {};
    const needs = ["bootstrap", "settings", "secret", "secret-clear", "stop"].includes(message.action || "") ? [] : REQUIRED;
    for (const permission of needs)
      if (!spindle.permissions.has(permission))
        throw new Error(`Grant ${permission} permission to use this action`);
    let result;
    switch (message.action) {
      case "bootstrap":
        result = { settings: await e.settings(), hasSecret: await spindle.enclave.has("catbox_userhash", userId), connections: spindle.permissions.has("image_gen") ? await spindle.imageGen.listConnections(userId) : [], providers: spindle.permissions.has("image_gen") ? await spindle.imageGen.getProviders(userId) : [] };
        break;
      case "settings":
        result = await e.saveSettings(input);
        break;
      case "secret": {
        const value = String(input.value || "").trim();
        if (!/^[a-zA-Z0-9]{8,256}$/.test(value))
          throw new Error("Enter the userhash from your Catbox account (letters and numbers)");
        await spindle.enclave.put("catbox_userhash", value, userId);
        result = true;
        break;
      }
      case "secret-clear":
        result = await spindle.enclave.delete("catbox_userhash", userId);
        break;
      case "load":
        result = { character: await spindle.characters.get(input.characterId, userId), data: await e.load(input.characterId) };
        break;
      case "guide":
        result = await e.guide(input.characterId, input.guide);
        break;
      case "create":
        result = await e.create(input);
        break;
      case "prepared":
        result = await e.prepared(input.characterId, input.id, input.prompt);
        break;
      case "failed":
        result = await e.failed(input.characterId, input.id, input.error);
        break;
      case "run":
        result = await e.run(input.characterId, input.id, input.options);
        break;
      case "stop":
        result = await e.stop(input.characterId, input.ids);
        break;
      case "apply":
        result = await e.apply(input.characterId, input.id, input.explicit);
        break;
      case "remove":
        result = await e.remove(input.characterId, input.index, input.original, input.occurrence);
        break;
      case "undo":
        result = await e.undo(input.characterId);
        break;
      case "eligibility":
        result = await e.fileEligibility(input.characterId, input.source);
        break;
      case "delete-public":
        result = await e.deletePublic(input.characterId, input.source);
        break;
      case "deleted-local":
        result = await e.deletedLocal(input.characterId, input.imageId);
        break;
      case "attach":
        result = await e.attach(input);
        break;
      case "reference-upload": {
        const { referenceParts: referenceParts2 } = await Promise.resolve().then(() => (init_core(), exports_core));
        referenceParts2(input.dataUrl);
        const image = await spindle.images.uploadFromDataUrl(input.dataUrl, { originalFilename: "set-reference.png", owner_character_id: input.characterId, userId });
        result = image.id;
        break;
      }
      default:
        throw new Error("Unknown extension request");
    }
    reply(result);
  } catch (error) {
    reply(undefined, error instanceof Error ? error.message : String(error));
  }
});
spindle.log.info("Greeting Image Generator loaded.");
