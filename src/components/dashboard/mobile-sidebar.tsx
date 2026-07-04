'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { navItems, isNavItemVisible, type DeploymentMode } from './nav-items';

interface MobileSidebarProps {
  open: boolean;
  activeSection: string;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  onNavClick: (_sectionId: string) => void;
  onClose: () => void;
  mode?: DeploymentMode | null;
}

export function MobileSidebar({
  open,
  activeSection,
  countMap,
  sectionsWithNotifications,
  onNavClick,
  onClose,
  mode,
}: MobileSidebarProps) {
  const visibleItems = useMemo(
    () => navItems.filter((item) => isNavItemVisible(item, mode)),
    [mode]
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-40 md:hidden"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed left-0 top-0 bottom-0 w-64 bg-card border-r border-border z-50 md:hidden"
          >
            <div className="flex items-center justify-between px-4 h-14 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg mesh-gradient flex items-center justify-center text-white font-bold text-sm">
                  H
                </div>
                <span className="font-bold text-lg">HiClaw</span>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="w-5 h-5" />
              </Button>
            </div>
            <nav className="py-2">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                const count = countMap[item.id] ?? 0;
                const hasNotification = sectionsWithNotifications.has(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavClick(item.id)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm relative ${
                      isActive
                        ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium'
                        : 'text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? 'text-orange-500' : ''}`} />
                    <span>{item.label}</span>
                    {count > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-auto text-[10px] h-5 min-w-[20px] px-1.5"
                      >
                        {count}
                      </Badge>
                    )}
                    {hasNotification && !isActive && (
                      <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse ml-1" />
                    )}
                  </button>
                );
              })}
            </nav>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
