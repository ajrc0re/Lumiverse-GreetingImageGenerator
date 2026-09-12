import type { CharacterDTO, ImageGenConnectionDTO, ImageGenProviderDTO } from 'lumiverse-spindle-types'
export type Character = CharacterDTO
export type Connection = ImageGenConnectionDTO
export type Provider = ImageGenProviderDTO
export const IDENTIFIER = 'lumiverse_greeting_image_generator'
export const REQUIRED = ['characters', 'chats', 'images', 'image_gen'] as const
export type Host = 'local' | 'catbox-anon' | 'catbox-auth'
export interface Settings {
  connectionId: string; model: string; presetId: string; instructions: string;
  host: Host; placement: 'start' | 'end'; review: boolean; reviewPrompt: boolean;
  negativePrompt: string; parameters: Record<string, string | number>;
}
export const DEFAULT_SETTINGS: Settings = {
  connectionId: '', model: '', presetId: '', instructions: '', host: 'local',
  placement: 'end', review: false, reviewPrompt: false, negativePrompt: '', parameters: {},
}
export interface Guide { style: string; referenceId?: string }
export interface Prompt { prompt: string; negativePrompt?: string }
export type Stage = 'queued' | 'preparing' | 'generating' | 'uploading' | 'saving' | 'review' | 'complete' | 'failed' | 'stopped'
export interface Job {
  id: string; characterId: string; chatId: string; index: number; original: string;
  title: string; settings: Settings; guide: Guide; stage: Stage; createdAt: number;
  prompt?: Prompt; imageId?: string; localUrl?: string; publicUrl?: string;
  accountFingerprint?: string; error?: string; stopped?: boolean; inserted?: boolean;
  generationStarted?: boolean; imageDeleted?: boolean;
}
export interface Undo { index: number; before: string; after: string }
export interface CharacterData { guide: Guide; jobs: Job[]; undo?: Undo }
export interface ImageOccurrence { start: number; end: number; source: string; alt: string; markup: string }
export interface Greeting { index: number; title: string; text: string; images: ImageOccurrence[] }
export interface NativeSettings {
  activePromptPresetId?: string; promptParserConnectionId?: string; promptParserModel?: string;
  customPrompt?: string; customNegativePrompt?: string;
  promptPresets?: Array<{ id: string; name: string; prompt: string; negativePrompt?: string; kind?: string }>;
}
