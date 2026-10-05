import { useQuery } from '@tanstack/react-query';
import { uploadApi, type BulkStatus } from '@/lib/api/entries';

export function useBulkUploadStatus(jobId: string | null): {
  data: BulkStatus | undefined;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: ['bulk-upload', jobId],
    queryFn: () => uploadApi.bulkStatus(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (q) => {
      const status = (q.state.data as BulkStatus | undefined)?.status;
      return status === 'done' || status === 'failed' || status === 'cancelled' ? false : 1500;
    },
  });
  return { data: query.data, isLoading: query.isLoading };
}
