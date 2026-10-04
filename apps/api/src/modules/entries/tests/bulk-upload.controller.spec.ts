import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BulkUploadController } from '../bulk-upload.controller';
import { BulkUploadService } from '../bulk-upload.service';

describe('BulkUploadController', () => {
  const bulk = {
    createJob: jest.fn(),
    getReport: jest.fn(),
    cancel: jest.fn(),
  };
  const controller = new BulkUploadController(bulk as unknown as BulkUploadService);
  const user = { id: 'owner1', email: 'o@x.y', nameAr: 'ن', nameEn: 'N', isActive: true };

  const report = { jobId: 'j1', status: 'processing', total: 3, results: [], resultsTruncated: false };

  beforeEach(() => jest.clearAllMocks());

  it('GET status: owner sees the report', async () => {
    bulk.getReport.mockResolvedValue(report);
    await expect(controller.bulkStatus('j1', user)).resolves.toEqual(report);
    expect(bulk.getReport).toHaveBeenCalledWith('j1', 'owner1');
  });

  it('GET status: non-owner without GROUP VIEW → 403 propagates', async () => {
    bulk.getReport.mockRejectedValue(new ForbiddenException('Insufficient permissions'));
    await expect(
      controller.bulkStatus('j1', { ...user, id: 'stranger' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('GET status: non-owner with GROUP VIEW → 200', async () => {
    bulk.getReport.mockResolvedValue({ ...report, jobId: 'j1' });
    await expect(controller.bulkStatus('j1', { ...user, id: 'admin' })).resolves.toMatchObject({
      jobId: 'j1',
    });
  });

  it('GET status: unknown jobId → 404 propagates', async () => {
    bulk.getReport.mockRejectedValue(new NotFoundException('Bulk job not found'));
    await expect(controller.bulkStatus('nope', user)).rejects.toBeInstanceOf(NotFoundException);
  });
});
