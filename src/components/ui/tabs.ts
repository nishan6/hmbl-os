/*
 * Section tabs as a segmented control: a sunken track with the current page
 * raised on it. Each tab is a link with aria-current="page" when selected.
 */
export const tabList =
  "bg-sunken mb-6 flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-md p-0.5";

export const tab =
  "text-secondary hover:text-text flex h-7 shrink-0 items-center rounded-sm px-3 text-sm font-medium whitespace-nowrap " +
  "transition-[color,background-color,box-shadow] duration-(--duration-fast) ease-(--ease-standard) " +
  "aria-[current=page]:bg-surface aria-[current=page]:text-text aria-[current=page]:shadow-sm " +
  "dark:aria-[current=page]:bg-elevated";
