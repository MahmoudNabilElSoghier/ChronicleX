'use client';

import { useDropzone } from 'react-dropzone';
import { useTranslations } from 'next-intl';
import { UploadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Dropzone({
  multiple,
  onFiles,
  disabled,
}: {
  multiple: boolean;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}): JSX.Element {
  const t = useTranslations('upload');
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    multiple,
    ...(disabled === undefined ? {} : { disabled }),
    accept: { 'application/pdf': ['.pdf'] },
    maxSize: 50 * 1024 * 1024,
    onDrop: (accepted) => onFiles(accepted),
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center transition-colors',
        isDragActive ? 'border-primary bg-primary/5' : 'hover:border-primary/50',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input {...getInputProps()} />
      <UploadCloud className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{t('dropzone')}</p>
      <p className="text-xs text-muted-foreground">{t('dropzoneHint')}</p>
    </div>
  );
}
