import * as React from "react"

import { cn } from "@/lib/utils"

type CardVariant = "default" | "elevated" | "glass"

interface CardProps extends React.ComponentProps<"div"> {
  variant?: CardVariant
}

// 卡片质感单轨（方案 v3 A-1）：三种变体只组合语义 token——底 --card（玻璃底是它的
// 透射 --card-glass）、边 --border、影 --shadow-card（值由 globals.css 按主题给）。
// globals.css 里剩下的 `.glass-card` / `.hover-lift` 是给存量调用点的同类实现，
// 新代码一律用这里的 variant。
const CARD_VARIANTS: Record<CardVariant, string> = {
  default: "bg-card shadow-card",
  elevated: "bg-card shadow-card ring-1 ring-border",
  glass: "bg-[var(--card-glass)] shadow-card backdrop-blur-xl",
}

function Card({ className, variant = "default", ...props }: CardProps) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      className={cn(
        "text-card-foreground flex flex-col gap-6 rounded-xl border py-6",
        CARD_VARIANTS[variant],
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
