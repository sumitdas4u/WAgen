import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSequence,
  fetchSequence,
  fetchSequenceEnrollments,
  fetchSequenceLogs,
  fetchSequences,
  pauseSequence,
  publishSequence,
  resumeSequence,
  updateSequenceDraft,
  type SequenceWriteInput
} from "../../../lib/api";
import { dashboardQueryKeys } from "../../../shared/dashboard/query-keys";

export function buildSequencesQueryOptions(token: string) {
  return queryOptions({
    queryKey: dashboardQueryKeys.sequences,
    queryFn: () => fetchSequences(token).then((response) => response.sequences),
    staleTime: 15_000
  });
}

export function useSequencesQuery(token: string) {
  return useQuery(buildSequencesQueryOptions(token));
}

export function useSequenceDetailQuery(token: string, sequenceId: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.sequenceDetail(sequenceId),
    queryFn: () => fetchSequence(token, sequenceId).then((response) => response.sequence),
    enabled: Boolean(token && sequenceId)
  });
}

export function useSequenceEnrollmentsQuery(token: string, sequenceId: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.sequenceEnrollments(sequenceId),
    queryFn: () => fetchSequenceEnrollments(token, sequenceId).then((response) => response.enrollments),
    enabled: Boolean(token && sequenceId)
  });
}

export function useSequenceLogsQuery(token: string, enrollmentId: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.sequenceLogs(enrollmentId),
    queryFn: () => fetchSequenceLogs(token, enrollmentId).then((response) => response.logs),
    enabled: Boolean(token && enrollmentId)
  });
}

export function useCreateSequenceMutation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SequenceWriteInput) => createSequence(token, payload).then((response) => response.sequence),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.sequenceRoot });
    }
  });
}

export function useUpdateSequenceMutation(token: string, sequenceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<SequenceWriteInput>) =>
      updateSequenceDraft(token, sequenceId, payload).then((response) => response.sequence),
    onSuccess: (sequence) => {
      queryClient.setQueryData(dashboardQueryKeys.sequenceDetail(sequenceId), sequence);
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.sequences });
    }
  });
}

function makeStatusMutation(
  action: (token: string, sequenceId: string) => Promise<{ sequence: unknown }>
) {
  return (token: string, sequenceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: () => action(token, sequenceId).then((response) => response.sequence),
      onSuccess: (sequence) => {
        queryClient.setQueryData(dashboardQueryKeys.sequenceDetail(sequenceId), sequence);
        void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.sequenceRoot });
      }
    });
  };
}

export const usePublishSequenceMutation = makeStatusMutation(publishSequence);
export const usePauseSequenceMutation = makeStatusMutation(pauseSequence);
export const useResumeSequenceMutation = makeStatusMutation(resumeSequence);
