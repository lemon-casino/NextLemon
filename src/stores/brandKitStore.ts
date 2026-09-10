import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { v4 as uuidv4 } from "uuid";
import type { BrandKit } from "@/types/brand";
import type { CreativeTombstone } from "@/types/projectPackage";
import { tauriStorage } from "@/utils/tauriStorage";

interface BrandKitStore {
  brandKits: BrandKit[];
  activeBrandKitId: string | null;
  tombstones: CreativeTombstone[];
  _hasHydrated: boolean;

  createBrandKit: (name?: string) => string;
  updateBrandKit: (brandKitId: string, patch: Partial<BrandKit>) => void;
  deleteBrandKit: (brandKitId: string) => void;
  setActiveBrandKit: (brandKitId: string | null) => void;
  getActiveBrandKit: () => BrandKit | null;
}

function now() {
  return Date.now();
}

function createDefaultBrandKit(): BrandKit {
  const timestamp = now();
  const id = uuidv4();
  return {
    id,
    name: "默认品牌套件",
    colors: ["#111827", "#2563eb", "#f8fafc"],
    fonts: {
      heading: "Inter",
      body: "Inter",
    },
    tone: "professional",
    referenceAssetIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function createBrandKitDraft(name = "新品牌套件"): BrandKit {
  const timestamp = now();
  return {
    id: uuidv4(),
    name,
    colors: ["#111827", "#22c55e", "#ffffff"],
    fonts: {},
    tone: "professional",
    referenceAssetIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const initialBrandKit = createDefaultBrandKit();

export const useBrandKitStore = create<BrandKitStore>()(
  persist(
    (set, get) => ({
      brandKits: [initialBrandKit],
      activeBrandKitId: initialBrandKit.id,
      tombstones: [],
      _hasHydrated: false,

      createBrandKit: (name) => {
        const brandKit = createBrandKitDraft(name);
        set((state) => ({
          brandKits: [brandKit, ...state.brandKits],
          activeBrandKitId: brandKit.id,
        }));
        return brandKit.id;
      },

      updateBrandKit: (brandKitId, patch) => {
        set((state) => ({
          brandKits: state.brandKits.map((brandKit) =>
            brandKit.id === brandKitId
              ? {
                  ...brandKit,
                  ...patch,
                  fonts: patch.fonts ? { ...brandKit.fonts, ...patch.fonts } : brandKit.fonts,
                  referenceAssetIds: patch.referenceAssetIds || brandKit.referenceAssetIds,
                  colors: patch.colors || brandKit.colors,
                  updatedAt: now(),
                }
              : brandKit
          ),
        }));
      },

      deleteBrandKit: (brandKitId) => {
        set((state) => {
          const brandKits = state.brandKits.filter((brandKit) => brandKit.id !== brandKitId);
          const fallback = brandKits[0] || createDefaultBrandKit();
          return {
            brandKits: brandKits.length > 0 ? brandKits : [fallback],
            activeBrandKitId: state.activeBrandKitId === brandKitId ? fallback.id : state.activeBrandKitId,
            // 只对真正删除的套件记墓碑；空列表兜底新建的默认套件是新实体
            tombstones: [
              ...state.tombstones.filter((tombstone) => tombstone.id !== brandKitId),
              { id: brandKitId, kind: "brandKit" as const, deletedAt: now() },
            ].slice(-500),
          };
        });
      },

      setActiveBrandKit: (brandKitId) => {
        set({ activeBrandKitId: brandKitId });
      },

      getActiveBrandKit: () => {
        const { activeBrandKitId, brandKits } = get();
        return brandKits.find((brandKit) => brandKit.id === activeBrandKitId) || null;
      },
    }),
    {
      name: "nextlemon-brand-kits",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        brandKits: state.brandKits,
        activeBrandKitId: state.activeBrandKitId,
        tombstones: state.tombstones,
      }),
      onRehydrateStorage: () => () => {
        useBrandKitStore.setState({ _hasHydrated: true });
      },
    }
  )
);
