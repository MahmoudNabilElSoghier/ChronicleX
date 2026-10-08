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
  // Both panels stay mounted for the page's lifetime and only visibility
  // changes: unmounting a tab would destroy its in-progress queue (files
  // dropped but not yet uploaded) — sessionStorage is deliberately NOT
  // used for the queue either: a reload starts clean.
  const [activeTab, setActiveTab] = React.useState<'single' | 'bulk'>('single');
  const singleHidden = activeTab !== 'single';
  const bulkHidden = activeTab !== 'bulk';
  const singlePanelRef = React.useRef<HTMLDivElement>(null);
  const bulkPanelRef = React.useRef<HTMLDivElement>(null);
  // React 18 has no typed `inert` prop — set the attribute imperatively so
  // the hidden panel is also skipped by focus navigation (aria-hidden alone
  // only hides it from assistive technology).
  React.useEffect(() => {
    singlePanelRef.current?.toggleAttribute('inert', singleHidden);
    bulkPanelRef.current?.toggleAttribute('inert', bulkHidden);
  }, [singleHidden, bulkHidden]);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'single' | 'bulk')}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="single">{t('tabs.single')}</TabsTrigger>
          <TabsTrigger value="bulk">{t('tabs.bulk')}</TabsTrigger>
        </TabsList>
        {/* forceMount: Radix would unmount the inactive panel (destroying
            its queue). Our `hidden`/`aria-hidden` replace its unmounting —
            contentProps spreads after Radix's own `hidden: !present`. */}
        <TabsContent
          value="single"
          forceMount
          ref={singlePanelRef}
          hidden={singleHidden}
          aria-hidden={singleHidden}
        >
          <SingleTab
            file={singleFile}
            onFileChange={setSingleFile}
            scope={singleScope}
            onScopeChange={setSingleScope}
          />
        </TabsContent>
        <TabsContent value="bulk" forceMount ref={bulkPanelRef} hidden={bulkHidden} aria-hidden={bulkHidden}>
          <BulkTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
