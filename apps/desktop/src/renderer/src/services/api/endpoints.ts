import {
  AutoEditPlanSchema,
  type AutoEditRequest,
  AppCredentialViewSchema,
  type AppCredentialKey,
  AiSettingsTestResultSchema,
  AiSettingsViewSchema,
  type AiSettingsInput,
  BrandSchema,
  type BrandUpdate,
  ChatMessageSchema,
  ContentSchema,
  type RegisterExport,
  type RegisterVideo,
  StorageStatusSchema,
  UploadTargetSchema,
  VariantAssetSchema,
  EditCarouselResultSchema,
  AnalyticsReportSchema,
  AnalyticsInsightsSchema,
  InsightsStateSchema,
  RecommendedSlotsSchema,
  WeekSummarySchema,
  PublicationMetricsSchema,
  type AnalyticsPeriod,
  type ManualMetricsInput,
  GenerateShortsResultSchema,
  type GenerateShortsRequest,
  type EditCarouselRequest,
  EditVariantResultSchema,
  IdeaSchema,
  PublicationChecksSchema,
  PublicationViewSchema,
  SocialAccountSchema,
  TagSchema,
  VariantRevisionSchema,
  VariantSchema,
  type BlogConnection,
  type BrandKit,
  BrandKitSchema,
  type VoiceExampleInput,
  VoiceExampleSchema,
  type Content,
  type EditVariantRequest,
  type GenerateContent,
  type VariantEdit,
  type VariantTransition,
  type IdeaInput,
  type Schedule,
  type IdeaListQuery,
  type IdeaUpdate,
  type TagInput,
} from '@prisma-app/shared';
import { z } from 'zod';
import { apiCommand, apiRequest } from './client';

/** Piattaforme che si collegano con OAuth dal browser. */
export type OAuthPlatform = 'linkedin' | 'instagram' | 'youtube' | 'tiktok';

/** Una funzione per rotta del server, con lo schema della risposta. */
export const api = {
  me: () => apiRequest('GET', '/me', z.object({ authenticated: z.literal(true) })),

  brands: () => apiRequest('GET', '/brands', z.array(BrandSchema)),

  brandKit: (brandId: number) => apiRequest('GET', `/brands/${brandId}/kit`, BrandKitSchema),
  saveBrandKit: (brandId: number, kit: BrandKit) =>
    apiRequest('PUT', `/brands/${brandId}/kit`, BrandKitSchema, kit),
  voiceExamples: (brandId: number) =>
    apiRequest('GET', `/brands/${brandId}/voice-examples`, z.array(VoiceExampleSchema)),
  addVoiceExample: (brandId: number, input: VoiceExampleInput) =>
    apiRequest('POST', `/brands/${brandId}/voice-examples`, VoiceExampleSchema, input),
  deleteVoiceExample: (id: number) => apiCommand('DELETE', `/voice-examples/${id}`),
  tags: (brandId: number) => apiRequest('GET', `/brands/${brandId}/tags`, z.array(TagSchema)),
  createTag: (brandId: number, input: TagInput) =>
    apiRequest('POST', `/brands/${brandId}/tags`, TagSchema, input),
  deleteTag: (id: number) => apiCommand('DELETE', `/tags/${id}`),
  updateBrand: (id: number, input: BrandUpdate) =>
    apiRequest('PATCH', `/brands/${id}`, BrandSchema, input),

  ideas: (brandId: number, query: IdeaListQuery = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.tagId) params.set('tagId', String(query.tagId));
    const suffix = params.size ? `?${params.toString()}` : '';
    return apiRequest('GET', `/brands/${brandId}/ideas${suffix}`, z.array(IdeaSchema));
  },
  createIdea: (brandId: number, input: Partial<IdeaInput> & { text: string }) =>
    apiRequest('POST', `/brands/${brandId}/ideas`, IdeaSchema, input),
  updateIdea: (id: number, input: IdeaUpdate) =>
    apiRequest('PATCH', `/ideas/${id}`, IdeaSchema, input),
  deleteIdea: (id: number) => apiCommand('DELETE', `/ideas/${id}`),

  generateContent: (input: GenerateContent): Promise<Content> =>
    apiRequest('POST', '/contents/generate', ContentSchema, input),
  content: (id: number) => apiRequest('GET', `/contents/${id}`, ContentSchema),
  idea: (id: number) => apiRequest('GET', `/ideas/${id}`, IdeaSchema),

  saveVariant: (id: number, input: VariantEdit) =>
    apiRequest('PATCH', `/variants/${id}`, VariantSchema, input),
  transitionVariant: (id: number, input: VariantTransition) =>
    apiRequest('POST', `/variants/${id}/transitions`, VariantSchema, input),
  revisions: (variantId: number) =>
    apiRequest('GET', `/variants/${variantId}/revisions`, z.array(VariantRevisionSchema)),
  restoreRevision: (variantId: number, revisionId: number, expectedVersion: number) =>
    apiRequest('POST', `/variants/${variantId}/revisions/${revisionId}/restore`, VariantSchema, {
      expectedVersion,
    }),
  editWithAi: (variantId: number, input: EditVariantRequest) =>
    apiRequest('POST', `/variants/${variantId}/edit`, EditVariantResultSchema, input),
  chat: (contentId: number) =>
    apiRequest('GET', `/contents/${contentId}/chat`, z.array(ChatMessageSchema)),

  contents: (brandId: number) =>
    apiRequest('GET', `/brands/${brandId}/contents`, z.array(ContentSchema)),

  publications: (brandId: number) =>
    apiRequest('GET', `/publications?brandId=${brandId}`, z.array(PublicationViewSchema)),
  schedule: (input: Schedule) => apiRequest('POST', '/publications', PublicationViewSchema, input),
  reschedule: (id: number, scheduledAt: string) =>
    apiRequest('PATCH', `/publications/${id}`, PublicationViewSchema, { scheduledAt }),
  publicationChecks: (brandId: number) =>
    apiRequest('GET', `/publications/checks?brandId=${brandId}`, z.array(PublicationChecksSchema)),
  publishNow: (id: number) =>
    apiRequest('POST', `/publications/${id}/publish-now`, PublicationViewSchema),
  cancelPublication: (id: number) =>
    apiRequest('POST', `/publications/${id}/cancel`, PublicationViewSchema),
  retryPublication: (id: number) =>
    apiRequest('POST', `/publications/${id}/retry`, PublicationViewSchema),

  socialAccounts: (brandId: number) =>
    apiRequest('GET', `/brands/${brandId}/social-accounts`, z.array(SocialAccountSchema)),
  connectBlog: (brandId: number, input: BlogConnection) =>
    apiRequest('PUT', `/brands/${brandId}/blog-connection`, SocialAccountSchema, input),
  testBlog: (brandId: number) =>
    apiRequest(
      'POST',
      `/brands/${brandId}/blog-connection/test`,
      z.object({ ok: z.literal(true) }),
    ),
  variantAssets: (variantId: number) =>
    apiRequest('GET', `/variants/${variantId}/assets`, z.array(VariantAssetSchema)),
  registerExport: (variantId: number, input: RegisterExport) =>
    apiRequest('PUT', `/variants/${variantId}/assets/export`, z.array(VariantAssetSchema), input),
  startUpload: (variantId: number, assetId: number) =>
    apiRequest('POST', `/variants/${variantId}/assets/${assetId}/upload`, UploadTargetSchema),
  completeUpload: (variantId: number, assetId: number) =>
    apiRequest(
      'POST',
      `/variants/${variantId}/assets/${assetId}/upload/complete`,
      z.array(VariantAssetSchema),
    ),
  registerVideo: (variantId: number, input: RegisterVideo) =>
    apiRequest(
      'PUT',
      `/variants/${variantId}/assets/video`,
      z.object({ variant: VariantSchema, assets: z.array(VariantAssetSchema) }),
      input,
    ),
  storageStatus: () => apiRequest('GET', '/storage/status', StorageStatusSchema),
  generateCarousel: (variantId: number, expectedVersion: number) =>
    apiRequest('POST', `/variants/${variantId}/carousel/generate`, VariantSchema, {
      expectedVersion,
    }),
  analyticsReport: (brandId: number, period: AnalyticsPeriod) =>
    apiRequest('GET', `/brands/${brandId}/analytics?period=${period}`, AnalyticsReportSchema),
  recommendedSlots: (brandId: number) =>
    apiRequest('GET', `/brands/${brandId}/analytics/slots`, RecommendedSlotsSchema),
  weekSummary: (brandId: number) =>
    apiRequest('GET', `/brands/${brandId}/analytics/summary`, WeekSummarySchema),
  insights: (brandId: number) =>
    apiRequest('GET', `/brands/${brandId}/analytics/insights`, InsightsStateSchema),
  generateInsights: (brandId: number) =>
    apiRequest('POST', `/brands/${brandId}/analytics/insights`, AnalyticsInsightsSchema),
  saveManualMetrics: (publicationId: number, input: ManualMetricsInput) =>
    apiRequest('POST', `/publications/${publicationId}/metrics`, PublicationMetricsSchema, input),
  autoEditPlan: (input: AutoEditRequest) =>
    apiRequest('POST', '/video/auto-edit', AutoEditPlanSchema, input),
  generateShorts: (input: GenerateShortsRequest) =>
    apiRequest('POST', '/shorts/generate', GenerateShortsResultSchema, input),
  editCarousel: (variantId: number, input: EditCarouselRequest) =>
    apiRequest('POST', `/variants/${variantId}/carousel/edit`, EditCarouselResultSchema, input),
  appCredentials: () => apiRequest('GET', '/settings/apps', z.array(AppCredentialViewSchema)),
  saveAppCredentials: (key: AppCredentialKey, body: unknown) =>
    apiRequest('PUT', `/settings/apps/${key}`, AppCredentialViewSchema, body),
  removeAppCredentials: (key: AppCredentialKey) =>
    apiRequest('DELETE', `/settings/apps/${key}`, AppCredentialViewSchema),
  aiSettings: () => apiRequest('GET', '/ai/settings', AiSettingsViewSchema),
  saveAiSettings: (input: AiSettingsInput) =>
    apiRequest('PUT', '/ai/settings', AiSettingsViewSchema, input),
  removeAiSettings: () => apiRequest('DELETE', '/ai/settings', AiSettingsViewSchema),
  /** Con `input` prova quel servizio prima di salvarlo; senza, quello in uso. */
  testAiSettings: (input?: AiSettingsInput) =>
    apiRequest('POST', '/ai/settings/test', AiSettingsTestResultSchema, input),
  /** URL di autorizzazione OAuth (LinkedIn, Instagram) da aprire nel browser di sistema. */
  authorizationUrl: (platform: OAuthPlatform, brandId: number) =>
    apiRequest('GET', `/oauth/${platform}/start?brandId=${brandId}`, z.object({ url: z.url() })),
};
