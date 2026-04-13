import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createMessageTemplate,
  deleteMessageTemplate,
  fetchTemplates,
  generateAITemplate,
  sendTestTemplateMessage,
  syncMessageTemplates,
  uploadTemplateMedia,
  type CreateTemplatePayload,
  type TemplateStyle
} from "../../../lib/api";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";

export function buildTemplatesQueryOptions(token: string, options?: { connectionId?: string | null }) {
  return queryOptions({
    queryKey: [...dashboardQueryKeys.templates, options?.connectionId ?? "all"],
    queryFn: () => fetchTemplates(token, { connectionId: options?.connectionId ?? undefined }).then((r) => r.templates),
    staleTime: 30_000
  });
}

export function useTemplatesQuery(token: string, options?: { connectionId?: string | null }) {
  return useQuery(buildTemplatesQueryOptions(token, options));
}

export function useCreateTemplateMutation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTemplatePayload) =>
      createMessageTemplate(token, payload).then((r) => r.template),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.templatesRoot });
    }
  });
}

export function useDeleteTemplateMutation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) => deleteMessageTemplate(token, templateId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.templatesRoot });
    }
  });
}

export function useSyncTemplatesMutation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => syncMessageTemplates(token).then((r) => r.templates),
    onSuccess: (templates) => {
      queryClient.setQueryData(dashboardQueryKeys.templates, templates);
    }
  });
}

export function useGenerateTemplateMutation(token: string) {
  return useMutation({
    mutationFn: (payload: { prompt: string; style: TemplateStyle }) =>
      generateAITemplate(token, payload).then((r) => r.generated)
  });
}

export function useUploadMediaMutation(token: string) {
  return useMutation({
    mutationFn: ({ connectionId, mediaType, file }: { connectionId: string; mediaType: "IMAGE" | "VIDEO" | "DOCUMENT"; file: File }) =>
      uploadTemplateMedia(token, connectionId, mediaType, file).then((r) => r.handle)
  });
}

export function useSendTestTemplateMutation(token: string) {
  return useMutation({
    mutationFn: (payload: { templateId: string; to: string; variableValues: Record<string, string> }) =>
      sendTestTemplateMessage(token, payload)
  });
}
