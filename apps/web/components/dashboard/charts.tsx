'use client';

import * as React from 'react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const PIE_COLORS = ['#1d4ed8', '#0d9488', '#7c3aed', '#db2777', '#ea580c', '#64748b'];

export function EntriesByYearChart({ data }: { data: { year: number; count: number }[] }): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <XAxis dataKey="year" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#1d4ed8" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function EntriesByTypeChart({ data }: { data: { prefix: string; count: number }[] }): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="prefix" innerRadius={52} outerRadius={84} paddingAngle={2}>
          {data.map((entry, i) => (
            <Cell key={entry.prefix} fill={PIE_COLORS[i % PIE_COLORS.length] ?? '#64748b'} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}
