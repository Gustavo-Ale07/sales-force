import { Controller, Inject } from '@nestjs/common';
import {
  API_BASE_PATH,
  routes,
  type DeviceSettings,
  type DeviceView,
  type DevicesResponse,
  type MyDeviceResponse,
} from '@salesforce/contracts';
import { ApiRoute, Contract, type RequestContract } from '../http/route.js';
import { CurrentUserParam, type CurrentUser } from './current-user.js';
import { DeviceService } from './device.service.js';

/**
 * Devices (W-36, M-02/M-18/M-19) and their installation settings. Thin: the central policy (`ROUTE_POLICY`) already decided who
 * may call; the service decides which devices the caller may see and manage (admin: all; manager: the team).
 */
@Controller(API_BASE_PATH)
export class DeviceController {
  constructor(
    @Inject(DeviceService) private readonly devices: DeviceService,
  ) {}

  @ApiRoute(routes.getMyDevice)
  async mine(@CurrentUserParam() user: CurrentUser): Promise<MyDeviceResponse> {
    if (user.deviceId == null || user.deviceStatus == null) return { device: null };
    return { device: await this.devices.sessionDevice(user.deviceId, user.deviceStatus) };
  }

  @ApiRoute(routes.reportDeviceSync)
  async reportSync(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.reportDeviceSync>,
  ): Promise<void> {
    if (user.deviceId == null) return;
    await this.devices.reportSync(user.deviceId, new Date(contract.body.syncedAt));
  }

  @ApiRoute(routes.listDevices)
  async list(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.listDevices>,
  ): Promise<DevicesResponse> {
    return { items: await this.devices.list({ accountId: user.accountId, role: user.role }, contract.query.status) };
  }

  @ApiRoute(routes.approveDevice)
  approve(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.approveDevice>,
  ): Promise<DeviceView> {
    return this.devices.approve({ accountId: user.accountId, role: user.role }, contract.params.id);
  }

  @ApiRoute(routes.revokeDevice)
  revoke(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.revokeDevice>,
  ): Promise<DeviceView> {
    return this.devices.revoke({ accountId: user.accountId, role: user.role }, contract.params.id);
  }

  @ApiRoute(routes.getDeviceSettings)
  settings(): Promise<DeviceSettings> {
    return this.devices.getSettings();
  }

  @ApiRoute(routes.updateDeviceSettings)
  updateSettings(
    @CurrentUserParam() user: CurrentUser,
    @Contract() contract: RequestContract<typeof routes.updateDeviceSettings>,
  ): Promise<DeviceSettings> {
    return this.devices.saveSettings({ accountId: user.accountId, role: user.role }, contract.body);
  }
}
