import type { KeyImage } from './key-images';

export interface Item {
  _id: string;
  id: string;
  namespace: string;
  title: string;
  description: string;
  keyImages: KeyImage[];
  categories: Category[];
  status: string;
  creationDate: string;
  lastModifiedDate: string;
  customAttributes: CustomAttributes;
  entitlementName: string;
  entitlementType: string;
  itemType: string;
  releaseInfo: {
    id: string;
    appId: string;
    platform: string[];
  }[];
  developer: string;
  developerId: string;
  eulaIds: string[];
  installModes: string[];
  endOfSupport: boolean;
  applicationId: string;
  unsearchable: boolean;
  requiresSecureAccount: boolean;
}

interface Category {
  path: string;
}

interface CustomAttributes {
  [key: string]: {
    type: string;
    value: string;
  };
}
