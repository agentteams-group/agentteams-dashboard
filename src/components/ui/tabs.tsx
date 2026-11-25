"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"
import { isDesktopHover } from "@/lib/desktop-interactions"

const HoverTabsContext = React.createContext<((_value: string) => void) | null>(null)

function Tabs({
  className,
  value, defaultValue, onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const [localValue, setLocalValue] = React.useState(defaultValue)
  const change = (next: string) => { if (value === undefined) setLocalValue(next); onValueChange?.(next) }
  return (
    <HoverTabsContext.Provider value={change}>
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
      value={value ?? localValue}
      onValueChange={change}
    />
    </HoverTabsContext.Provider>
  )
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-11 w-fit items-center justify-center rounded-lg p-[3px] sm:h-9",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  onPointerEnter,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const change = React.useContext(HoverTabsContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "data-[state=active]:bg-background dark:data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
      onPointerEnter={event => { onPointerEnter?.(event); if (!event.defaultPrevented && !props.disabled && isDesktopHover(event)) change?.(props.value) }}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
