'use client';

import { useMemo } from 'react';
import {
  navItems,
  navAreas,
  navGroups,
  legacyNavGroups,
  isNavItemVisible,
  type NavItem,
  type DeploymentMode,
} from './nav-items';
import type { NavArea } from '@/lib/nav-hash';

/**
 * Sidebar section grouping for the two navigation modes (PRD §5.2 / §5.4):
 *
 * - Workbench (default): two areas — 工作台 (workbench) and 控制台
 *   (console) — each subdivided into labelled groups.
 * - Classic (classicNavigation on): the v1.x flat 基础/运行时/资源中心
 *   grouping, kept for one release cycle as a migration aid.
 */

export interface NavGroupSection {
  key: string;
  label: string;
  items: NavItem[];
}

export interface NavAreaSection {
  key: string;
  label: string | null;
  groups: NavGroupSection[];
}

export function useNavSections(
  mode: DeploymentMode | null | undefined,
  taskBoardVisible: boolean,
  userLevel: number,
  classicNavigation: boolean
): NavAreaSection[] {
  return useMemo(() => {
    const visible = navItems.filter((item) =>
      isNavItemVisible(item, mode, taskBoardVisible, userLevel)
    );

    if (classicNavigation) {
      return [
        {
          key: 'classic',
          label: null,
          groups: legacyNavGroups
            .map((group) => ({
              key: `legacy-${group.id}`,
              label: group.label,
              items: visible.filter((item) => item.legacyGroup === group.id),
            }))
            .filter((group) => group.items.length > 0),
        },
      ];
    }

    return navAreas.map((area) => ({
      key: area.id,
      label: area.label,
      groups: navGroups
        .filter((group) => group.area === area.id)
        .map((group) => ({
          key: `${area.id}-${group.id}`,
          label: group.label,
          items: visible.filter(
            (item) => item.area === (area.id as NavArea) && item.group === group.id
          ),
        }))
        .filter((group) => group.items.length > 0),
    }));
  }, [mode, taskBoardVisible, userLevel, classicNavigation]);
}
