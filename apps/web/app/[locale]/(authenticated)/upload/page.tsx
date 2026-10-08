'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { BulkTab } from '@/components/upload/bulk-tab';
import { SingleTab } from '@/components/upload/single-tab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { QueueScope } from '@/lib/upload/use-upload-queue';

export default function UploadPage(): JSX.Element {
  const t = useTranslations('upload');
  // Single-tab file + scope live on the page (which never unmounts on tab
  // switches) — deliberately NOT sessionStorage: a reload starts clean.
  const [singleFile, setSingleFile] = React.useState<File | null>(null);
  const [singleScope, setSingleScope] = React.useState<QueueScope>({
    companyId: '',
    projectId: '',
    year: '',
  });
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <Tabs defaultValue="single" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="single">{t('tabs.single')}</TabsTrigger>
          <TabsTrigger value="bulk">{t('tabs.bulk')}</TabsTrigger>
        </TabsList>
        <TabsContent value="single">
          <SingleTab
            file={singleFile}
            onFileChange={setSingleFile}
            scope={singleScope}
            onScopeChange={setSingleScope}
          />
        </TabsContent>
        <TabsContent value="bulk">
          <BulkTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
