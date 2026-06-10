import type { RestorePosition, Settings } from "@prisma/client";
import prisma from "../db.server";
import { ensureShop } from "./shop.server";

export type SettingsInput = {
  enabled: boolean;
  pushSoldOutToBottom: boolean;
  restoreWhenBackInStock: boolean;
  restorePosition: RestorePosition;
};

export type SettingsUpdateResult =
  | { success: true; settings: Settings }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

const RESTORE_POSITIONS: RestorePosition[] = ["ORIGINAL", "TOP"];

function formFlag(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

export function parseSettingsFormData(
  formData: FormData,
):
  | { ok: true; data: SettingsInput }
  | { ok: false; error: string; fieldErrors?: Record<string, string> } {
  const restorePosition = formData.get("restorePosition");

  if (
    typeof restorePosition !== "string" ||
    !RESTORE_POSITIONS.includes(restorePosition as RestorePosition)
  ) {
    return {
      ok: false,
      error: "Invalid restore position.",
      fieldErrors: { restorePosition: "Choose original position or top." },
    };
  }

  return {
    ok: true,
    data: {
      enabled: formFlag(formData, "enabled"),
      pushSoldOutToBottom: formFlag(formData, "pushSoldOutToBottom"),
      restoreWhenBackInStock: formFlag(formData, "restoreWhenBackInStock"),
      restorePosition: restorePosition as RestorePosition,
    },
  };
}

export async function getSettingsForShop(
  shopDomain: string,
): Promise<Settings> {
  const shop = await ensureShop(shopDomain);
  if (!shop.settings) {
    throw new Error(`Settings missing for shop: ${shopDomain}`);
  }
  return shop.settings;
}

export async function updateSettingsForShop(
  shopDomain: string,
  input: SettingsInput,
): Promise<SettingsUpdateResult> {
  try {
    const shop = await ensureShop(shopDomain);

    if (!shop.settings) {
      return { success: false, error: "Settings not found for this store." };
    }

    const settings = await prisma.settings.update({
      where: { shopId: shop.id },
      data: {
        enabled: input.enabled,
        pushSoldOutToBottom: input.pushSoldOutToBottom,
        restoreWhenBackInStock: input.restoreWhenBackInStock,
        restorePosition: input.restorePosition,
      },
    });

    return { success: true, settings };
  } catch {
    return {
      success: false,
      error: "Could not save settings. Please try again.",
    };
  }
}
