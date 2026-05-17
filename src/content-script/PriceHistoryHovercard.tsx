import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { messagingClient } from '@/lib/clients/messaging';
import type {
  OfferPriceHistoryResult,
  PriceHistoryPoint,
  PriceHistoryRequest,
  PriceHistoryTimeFrame,
} from '@/lib/messages';
import { ChartLine } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

interface PriceHistoryHovercardProps {
  request: PriceHistoryRequest;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: OfferPriceHistoryResult }
  | { status: 'error'; message: string };

const chartConfig = {
  price: {
    label: 'Price',
    color: '#00d084',
  },
} satisfies ChartConfig;

const TIME_FRAMES: Array<{ label: string; value: PriceHistoryTimeFrame }> = [
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
  { label: '2Y', value: '2y' },
  { label: 'All', value: 'all' },
];

const CONTENT_MIN_HEIGHT_CLASS = 'min-h-[200px]';

function isPriceHistoryTimeFrame(
  value: string,
): value is PriceHistoryTimeFrame {
  return TIME_FRAMES.some((option) => option.value === value);
}

function formatMoney(
  amount: number | null,
  currencyCode: string,
  locale?: string,
) {
  if (amount === null) {
    return 'N/A';
  }

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currencyCode}`;
  }
}

function formatDate(date: string, locale?: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: 'numeric',
    }).format(new Date(date));
  } catch {
    return date.slice(0, 10);
  }
}

function toChartData(
  points: PriceHistoryPoint[],
  currencyCode: string,
  locale?: string,
) {
  return points.map((point) => ({
    date: point.date,
    label: formatDate(point.date, locale),
    price: point.discountPrice,
    formattedPrice: formatMoney(point.discountPrice, currencyCode, locale),
  }));
}

function PriceHistoryChart({
  points,
  currencyCode,
  locale,
}: {
  points: PriceHistoryPoint[];
  currencyCode: string;
  locale?: string;
}) {
  const data = useMemo(
    () => toChartData(points, currencyCode, locale),
    [points, currencyCode, locale],
  );

  if (points.length < 2) {
    return (
      <div className="flex h-28 items-center rounded-md border border-dashed border-white/15 px-3 text-sm text-white/60">
        No history yet
      </div>
    );
  }

  return (
    <ChartContainer
      config={chartConfig}
      className="h-28 w-full min-w-0 overflow-hidden"
    >
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
      >
        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.12)" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          minTickGap={24}
          tickMargin={8}
          tick={{ fill: 'rgba(255,255,255,0.58)', fontSize: 11 }}
        />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <ChartTooltip
          cursor={{ stroke: 'rgba(255,255,255,0.24)' }}
          content={
            <ChartTooltipContent
              indicator="line"
              hideLabel
              formatter={(_, __, item) => {
                const label =
                  typeof item.payload?.label === 'string'
                    ? item.payload.label
                    : '';
                const formattedPrice =
                  typeof item.payload?.formattedPrice === 'string'
                    ? item.payload.formattedPrice
                    : '';

                return (
                  <div className="flex min-w-[8rem] items-center justify-between gap-3">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-foreground font-mono font-medium">
                      {formattedPrice}
                    </span>
                  </div>
                );
              }}
            />
          }
        />
        <Line
          type="stepAfter"
          dataKey="price"
          stroke="var(--color-price)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 3 }}
        />
      </LineChart>
    </ChartContainer>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-md bg-white/[0.04] px-2.5 py-2">
      <div className="text-[11px] leading-none text-white/55">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold leading-tight text-white">
        {value}
      </div>
    </div>
  );
}

function TimeFrameSelector({
  value,
  onChange,
}: {
  value: PriceHistoryTimeFrame;
  onChange: (value: PriceHistoryTimeFrame) => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(nextValue) => {
        if (isPriceHistoryTimeFrame(nextValue)) {
          onChange(nextValue);
        }
      }}
      className="egdata-price-frame-tabs"
    >
      <TabsList
        className="egdata-price-frame-list"
        aria-label="Price history range"
      >
        {TIME_FRAMES.map((option) => (
          <TabsTrigger
            key={option.value}
            className="egdata-price-frame-trigger"
            value={option.value}
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function PriceHistoryContent({
  state,
  locale,
}: {
  state: LoadState;
  locale?: string;
}) {
  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <div
        className={`${CONTENT_MIN_HEIGHT_CLASS} flex items-center justify-center rounded-md border border-dashed border-white/15 text-sm text-white/60`}
      >
        Loading price history
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div
        className={`${CONTENT_MIN_HEIGHT_CLASS} flex items-center rounded-md border border-destructive/40 bg-destructive/10 px-3 text-sm text-white/75`}
      >
        {state.message}
      </div>
    );
  }

  const { data } = state;
  const currencyCode = data.currencyCode;

  return (
    <div className={`${CONTENT_MIN_HEIGHT_CLASS} space-y-3`}>
      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="Current"
          value={formatMoney(
            data.currentPrice.discountPrice,
            currencyCode,
            locale,
          )}
        />
        <Stat
          label="Low"
          value={formatMoney(data.minPrice, currencyCode, locale)}
        />
        <Stat
          label="High"
          value={formatMoney(data.maxPrice, currencyCode, locale)}
        />
      </div>
      <PriceHistoryChart
        points={data.points}
        currencyCode={currencyCode}
        locale={locale}
      />
      <div className="flex items-center justify-between text-[11px] text-white/50">
        <span>egdata.app</span>
        <span>Region: {data.region}</span>
      </div>
    </div>
  );
}

export function PriceHistoryHovercard({ request }: PriceHistoryHovercardProps) {
  const [timeFrame, setTimeFrame] = useState<PriceHistoryTimeFrame>('2y');
  const [states, setStates] = useState<
    Partial<Record<PriceHistoryTimeFrame, LoadState>>
  >({});
  const state = states[timeFrame] ?? { status: 'idle' };

  const loadHistory = useCallback(
    (nextTimeFrame = timeFrame) => {
      const current = states[nextTimeFrame];
      if (current && current.status !== 'idle') {
        return;
      }

      setStates((currentStates) => ({
        ...currentStates,
        [nextTimeFrame]: { status: 'loading' },
      }));

      messagingClient
        .getOfferPriceHistory({
          ...request,
          timeFrame: nextTimeFrame,
        })
        .then((data) =>
          setStates((currentStates) => ({
            ...currentStates,
            [nextTimeFrame]: { status: 'success', data },
          })),
        )
        .catch((error) =>
          setStates((currentStates) => ({
            ...currentStates,
            [nextTimeFrame]: {
              status: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'Unable to load price history',
            },
          })),
        );
    },
    [request, states, timeFrame],
  );

  const selectTimeFrame = (nextTimeFrame: PriceHistoryTimeFrame) => {
    setTimeFrame(nextTimeFrame);
    loadHistory(nextTimeFrame);
  };

  return (
    <HoverCard
      openDelay={120}
      closeDelay={120}
      onOpenChange={(open) => {
        if (open) {
          loadHistory();
        }
      }}
    >
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="egdata-price-history-trigger"
          aria-label="Show egdata price history"
        >
          <ChartLine aria-hidden="true" size={14} strokeWidth={2.2} />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="egdata-price-history-content z-[2147483647] w-[320px] rounded-lg border-white/12 bg-[#121212] p-3 text-white shadow-2xl outline-none"
      >
        <div className="mb-3 space-y-2.5">
          <div className="text-sm font-semibold leading-none text-white">
            Price history
          </div>
          <TimeFrameSelector value={timeFrame} onChange={selectTimeFrame} />
        </div>
        <PriceHistoryContent state={state} locale={request.locale} />
      </HoverCardContent>
    </HoverCard>
  );
}
