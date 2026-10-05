'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useTranslations } from 'next-intl';
import * as React from 'react';
import { Download, Eye, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import type { EntryListItem } from '@/lib/api/entries';
import { formatBytes, formatDateTime } from '@/lib/format';

export interface RowActions {
  onView: (entry: EntryListItem) => void;
  onDownload: (entry: EntryListItem) => void;
  onDelete: (entry: EntryListItem) => void;
  onRestore: (entry: EntryListItem) => void;
  canDelete: boolean;
  canRestore: boolean;
}

export function EntriesTable({
  items,
  actions,
  locale,
}: {
  items: EntryListItem[];
  actions: RowActions;
  locale: string;
}): JSX.Element {
  const t = useTranslations('entries');

  const columns = React.useMemo<ColumnDef<EntryListItem>[]>(
    () => [
      {
        accessorKey: 'serial',
        header: () => t('columns.serial'),
        cell: ({ row }) => (
          <span className="font-mono" dir="ltr">
            {row.original.serial}
          </span>
        ),
      },
      {
        accessorKey: 'company',
        header: () => t('columns.company'),
        cell: ({ row }) => row.original.company.nameAr,
      },
      {
        accessorKey: 'project',
        header: () => t('columns.project'),
        cell: ({ row }) => row.original.project.nameAr,
      },
      {
        accessorKey: 'year',
        header: () => t('columns.year'),
        cell: ({ row }) => <span dir="ltr">{row.original.year}</span>,
      },
      {
        accessorKey: 'typePrefix',
        header: () => t('columns.type'),
        cell: ({ row }) => <span dir="ltr">{row.original.typePrefix}</span>,
      },
      {
        accessorKey: 'fileName',
        header: () => t('columns.fileName'),
        cell: ({ row }) => (
          <span className="block max-w-48 truncate" title={row.original.fileName}>
            {row.original.fileName}
          </span>
        ),
      },
      {
        accessorKey: 'fileSize',
        header: () => t('columns.size'),
        cell: ({ row }) => <span dir="ltr">{formatBytes(row.original.fileSize)}</span>,
      },
      {
        accessorKey: 'createdAt',
        header: () => t('columns.createdAt'),
        cell: ({ row }) => formatDateTime(row.original.createdAt, locale),
      },
      {
        id: 'actions',
        header: () => '',
        cell: ({ row }) => {
          const entry = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('actions.open')}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => actions.onView(entry)}>
                  <Eye />
                  {t('actions.view')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.onDownload(entry)}>
                  <Download />
                  {t('actions.download')}
                </DropdownMenuItem>
                {actions.canDelete && !entry.deletedAt ? (
                  <DropdownMenuItem onClick={() => actions.onDelete(entry)}>
                    <Trash2 />
                    {t('actions.delete')}
                  </DropdownMenuItem>
                ) : null}
                {actions.canRestore && entry.deletedAt ? (
                  <DropdownMenuItem onClick={() => actions.onRestore(entry)}>
                    <RotateCcw />
                    {t('actions.restore')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [t, actions, locale],
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 8,
    // jsdom (tests) reports zero layout boxes; the initial rect renders an
    // estimated window until the browser measures the real container.
    initialRect: { width: 1024, height: 600 },
  });

  const rows = table.getRowModel().rows;

  return (
    <div ref={scrollRef} className="max-h-[60vh] overflow-auto rounded-md border">
      <table className="w-full caption-bottom text-sm">
        <thead className="sticky top-0 z-10 bg-muted [&_tr]:border-b">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="h-10 px-3 text-start align-middle font-medium text-muted-foreground">
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody
          style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
          className="[&_tr]:border-b"
        >
          {virtualizer.getVirtualItems().map((virtual) => {
            const row = rows[virtual.index];
            if (!row) return null;
            return (
              <tr
                key={row.id}
                data-state={row.getIsSelected() && 'selected'}
                onClick={() => actions.onView(row.original)}
                className="absolute start-0 end-0 top-0 flex h-14 cursor-pointer items-center border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted"
                style={{ transform: `translateY(${virtual.start}px)` }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="flex-1 px-3 py-2 align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function TableSkeleton(): JSX.Element {
  return (
    <div className="space-y-2">
      {Array.from({ length: 10 }, (_, i) => (
        <Skeleton key={i} className="h-14" />
      ))}
    </div>
  );
}
