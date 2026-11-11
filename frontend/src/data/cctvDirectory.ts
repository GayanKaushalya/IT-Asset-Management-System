/** CCTV contact & site directory — sourced from CCTV Contact Information.xlsx */

export type CctvContact = {
  id: number;
  location: string;
  servicePerson: string;
  phones: string[];
};

export type CctvSystem = {
  id: number;
  location: string;
  recordingDuration: string;
  hdd: string;
  deviceType: string;
  brand: string;
  model: string;
  channels: string;
  cameras: string;
  serialNumber: string;
  remark: string;
};

export type CctvIpCamera = {
  id: number;
  floor: string;
  item: string;
  invoiceNo: string;
  serialNumber: string;
  type: string;
  brand: string;
  defaultIp: string;
  warranty: string;
  invoiceDate: string;
  location: string;
};

export const CCTV_CONTACTS: CctvContact[] = [
  { id: 1, location: 'Head Office', servicePerson: 'Mr Ajith / Danushaka', phones: ['0777161663', '0769927649'] },
  { id: 2, location: 'Colombo Branch', servicePerson: 'Mr Suranga', phones: ['0787688228'] },
  { id: 3, location: 'Kelaniya Branch', servicePerson: 'Mr Ajith / Suranga', phones: ['0777161663', '0787688228'] },
  { id: 4, location: 'Kelaniya ISP', servicePerson: 'Mr Ajith / Suranga', phones: ['0777161663', '0787688228'] },
  { id: 5, location: 'Kelaniya Foton', servicePerson: 'Mr Danushka', phones: ['0769927649'] },
  { id: 6, location: 'Negombo Branch', servicePerson: 'Mr Charith', phones: ['0778925299'] },
  { id: 7, location: 'Matara ISP / IMS', servicePerson: 'Mr Ajith / Sahan', phones: ['0777161663', '0724108082'] },
  { id: 8, location: 'Matara Branch', servicePerson: 'Mr Ajith / Sahan', phones: ['0777161663', '0724108082'] },
  { id: 9, location: 'Anuradhapura ISP-BR', servicePerson: 'Mr Ajith', phones: ['0777161663'] },
  { id: 10, location: 'Kandy ISP', servicePerson: 'Mr Ajith', phones: ['0777161663'] },
  { id: 11, location: '201 IMS', servicePerson: 'Mr Ajith', phones: ['0777161663'] },
  { id: 12, location: '140 IMS', servicePerson: 'Mr Ajith', phones: ['0777161663'] },
  { id: 13, location: '43 IMS', servicePerson: 'Mr Ajith', phones: ['0777161663'] },
  { id: 14, location: 'Ambatanna IMS', servicePerson: 'Mr Ajith', phones: ['0777161663'] },
  { id: 15, location: 'Gampola IMS', servicePerson: 'Mr Ajith', phones: ['0777161663'] },
  { id: 16, location: 'HydePark IMS', servicePerson: 'Mr Suranga', phones: ['0787688228'] },
  { id: 17, location: 'Embilipitiya IMS', servicePerson: 'Mr Senaka', phones: ['0770058663'] },
  { id: 18, location: 'Kurunegala', servicePerson: 'Mr Ajith', phones: ['0777161663'] },
  { id: 19, location: 'BYD Showroom', servicePerson: '', phones: [] },
  { id: 20, location: 'BYD Yard', servicePerson: 'Mr Ajith', phones: ['0777161663'] },
  { id: 21, location: 'New Property (near BYD Showroom)', servicePerson: 'Mr Ajith', phones: ['0777161663'] },
];

export const CCTV_SYSTEMS: CctvSystem[] = [
  { id: 1, location: 'Head Office', recordingDuration: '19 Days', hdd: '4TB', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7116HGHI-F1', channels: '16', cameras: '9', serialNumber: '1620170724CCWR801957092WCVU', remark: '' },
  { id: 2, location: 'Colombo Branch', recordingDuration: '8 Days', hdd: '4TB', deviceType: 'NVR', brand: 'Hikvision', model: 'DS-7632NXI-K2(D)', channels: '32', cameras: '32', serialNumber: 'FY5844459', remark: '' },
  { id: 3, location: 'Kelaniya Branch', recordingDuration: '24 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7116HGHI-K1', channels: '16', cameras: '', serialNumber: '1620210420CCWRF88352172WCVU / F88352172', remark: '' },
  { id: 4, location: 'Kelaniya ISP', recordingDuration: '15 Days', hdd: '', deviceType: 'DVR/NVR', brand: 'Hikvision', model: 'DS-7232HGHI-M2', channels: '32', cameras: '21', serialNumber: '03220200410CCWRE33362315WCVU / AZ7400725', remark: '' },
  { id: 5, location: 'Negombo Branch', recordingDuration: '28 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7108HQHI-K1', channels: '8', cameras: '6', serialNumber: '0820200921CCWRB78164493WCVU / B78164493', remark: '' },
  { id: 6, location: 'Matara Branch', recordingDuration: '20 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7216HGHI-K1', channels: '16', cameras: '11', serialNumber: '1620190812CCWRD49777412WCVU / D49777412', remark: '' },
  { id: 7, location: 'Matara ISP / IMS', recordingDuration: '21 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7108HQHI-K1', channels: '8', cameras: '', serialNumber: '0820210105CCWRF37297684WCVU / F37297684', remark: '' },
  { id: 8, location: 'Anuradhapura ISP-BR', recordingDuration: '12 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7108HGHI-M1', channels: '8', cameras: '8', serialNumber: '0820230624CCWRAC9440748WCVU / AC9440748', remark: '' },
  { id: 9, location: 'Kandy ISP', recordingDuration: '26 Days', hdd: '6TB', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7232HGHI-M2', channels: '32', cameras: '25', serialNumber: '3220250716CCWRGC9816804WCVU / GC9816804', remark: '' },
  { id: 10, location: '201 IMS', recordingDuration: '24 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7108HGHI-K1', channels: '16', cameras: '11', serialNumber: '1620221230CCWRL16616063WCVU / L16616063', remark: '' },
  { id: 11, location: '140 IMS', recordingDuration: '23 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7108HGHI-F1/N', channels: '8', cameras: '6', serialNumber: '0820210105CCWRF37306448WCVU / F37306448', remark: '' },
  { id: 12, location: '43 IMS', recordingDuration: '21 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7108HGHI-F1/N', channels: '8', cameras: '8', serialNumber: '0820210105CCWRF37306306WCVU / F37306306', remark: '' },
  { id: 13, location: 'Ambatanna IMS', recordingDuration: '26 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7108HGHI-K1', channels: '8', cameras: '5', serialNumber: '0820230526CCWRL52765398WCVU / L52765398', remark: 'Not working' },
  { id: 14, location: 'Gampola IMS', recordingDuration: '98 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7108HGHI-K1', channels: '8', cameras: '6', serialNumber: '0820230526CCWRL52765514WCVU / L52765514', remark: '' },
  { id: 15, location: 'HydePark IMS', recordingDuration: '21 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7108HQHI-K1', channels: '8', cameras: '6', serialNumber: '0820171101CCWR124380304WCVU / 124380304', remark: '' },
  { id: 16, location: 'Embilipitiya IMS', recordingDuration: '56 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7216HGHI-K1', channels: '8', cameras: '5', serialNumber: 'K05101790', remark: '' },
  { id: 17, location: 'Kurunegala 1', recordingDuration: '', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: '', channels: '', cameras: '', serialNumber: '', remark: '' },
  { id: 18, location: 'Kurunegala 2', recordingDuration: '16 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'iDS-7116HQHI-M1/S', channels: '16', cameras: '11', serialNumber: 'FN7572022', remark: '' },
  { id: 19, location: '2nd floor WiFi Camera', recordingDuration: '', hdd: '', deviceType: 'SIM Camera', brand: 'EZVIZ', model: 'CS-H8c', channels: '1', cameras: '1', serialNumber: 'BE8768064', remark: '' },
  { id: 20, location: 'BYD Yard (Ra Kade)', recordingDuration: '', hdd: '', deviceType: 'SIM Camera', brand: 'V380 Pro', model: '', channels: '1', cameras: '2', serialNumber: '105100283', remark: '' },
  { id: 21, location: 'BYD Yard (Ra Kade)', recordingDuration: '', hdd: '', deviceType: 'SIM Camera', brand: 'V380 Pro', model: '', channels: '1', cameras: '2', serialNumber: '105049321', remark: '' },
  { id: 22, location: '4th Floor (Head Office)', recordingDuration: '8 Days', hdd: '2TB', deviceType: 'NVR', brand: 'Hikvision', model: 'DS-7632NXI-K2(D)', channels: '32', cameras: '13', serialNumber: 'GB8873262', remark: '' },
  { id: 23, location: 'IMP Doors', recordingDuration: '', hdd: '320GB', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7104HGHI-F1', channels: '4', cameras: '4', serialNumber: '0420200603AAWRE47412446WCVU', remark: '' },
  { id: 24, location: 'Foton Kelaniya', recordingDuration: '34 Days', hdd: '6TB', deviceType: 'NVR', brand: 'Hikvision', model: 'DS-7616NI-K2/16P', channels: '16', cameras: '16', serialNumber: 'J05551125', remark: '' },
  { id: 25, location: 'BYD Showroom', recordingDuration: '22 Days', hdd: '', deviceType: 'DVR', brand: 'Hikvision', model: 'DS-7116HGHI-M1/T', channels: '', cameras: '', serialNumber: 'GD0572152', remark: '' },
  { id: 26, location: 'New Property (near BYD Showroom)', recordingDuration: '16 Days', hdd: '', deviceType: 'SIM Camera', brand: 'Hikvision', model: 'DS-2DE2C200MWG-4G', channels: '1', cameras: '1', serialNumber: 'GD4183384', remark: 'IMEI 867156064779707' },
  { id: 27, location: 'New Property (near BYD Showroom)', recordingDuration: '16 Days', hdd: '', deviceType: 'SIM Camera', brand: 'Hikvision', model: 'DS-2DE2C200MWG-4G', channels: '1', cameras: '1', serialNumber: 'GD4183372', remark: 'IMEI 867156064819743' },
  { id: 28, location: 'New Property (near BYD Showroom)', recordingDuration: '16 Days', hdd: '', deviceType: 'SIM Camera', brand: 'Hikvision', model: 'DS-2DE2C200MWG-4G', channels: '1', cameras: '1', serialNumber: 'GD4183365', remark: 'IMEI 867156064810627' },
];

export const CCTV_IP_CAMERAS: CctvIpCamera[] = [
  { id: 1, floor: '4th', item: 'POE Switch', invoiceNo: '', serialNumber: '22446R3001969', type: 'MS110P', brand: 'Mercusys', defaultIp: '8 Port', warranty: '2Y', invoiceDate: '2025-11-13', location: '' },
  { id: 2, floor: '4th', item: 'NVR', invoiceNo: '', serialNumber: 'GB8873262', type: 'DS-7632NXI-K2(D)', brand: 'Hikvision', defaultIp: '32 channel', warranty: '2Y', invoiceDate: '2025-11-14', location: '' },
  { id: 3, floor: '4th', item: 'Camera', invoiceNo: '', serialNumber: 'FY2412330', type: 'DS-2CD1327G2H-LIU (2.8mm)', brand: 'Hikvision', defaultIp: '192.168.10.131', warranty: '2Y', invoiceDate: '2025-11-07', location: 'Lobby' },
  { id: 4, floor: '4th', item: 'Camera', invoiceNo: '', serialNumber: 'FY1924496', type: 'DS-2CD1327G2H-LIU (2.8mm)', brand: 'Hikvision', defaultIp: '192.168.10.132', warranty: '2Y', invoiceDate: '2025-11-08', location: 'HR' },
  { id: 5, floor: '4th', item: 'Camera', invoiceNo: '', serialNumber: 'FY1924813', type: 'DS-2CD1327G2H-LIU (2.8mm)', brand: 'Hikvision', defaultIp: '192.168.10.133', warranty: '2Y', invoiceDate: '2025-11-09', location: 'Legal' },
  { id: 6, floor: '4th', item: 'Camera', invoiceNo: '', serialNumber: 'FY2412665', type: 'DS-2CD1327G2H-LIU (2.8mm)', brand: 'Hikvision', defaultIp: '192.168.10.134', warranty: '2Y', invoiceDate: '2025-11-10', location: 'Training room' },
  { id: 7, floor: '4th', item: 'Camera', invoiceNo: '', serialNumber: 'FY2412555', type: 'DS-2CD1327G2H-LIU (2.8mm)', brand: 'Hikvision', defaultIp: '192.168.10.135', warranty: '2Y', invoiceDate: '2025-11-11', location: 'Admin' },
  { id: 8, floor: '4th', item: 'Camera', invoiceNo: '', serialNumber: 'FY1924809', type: 'DS-2CD1327G2H-LIU (2.8mm)', brand: 'Hikvision', defaultIp: '192.168.10.136', warranty: '2Y', invoiceDate: '2025-11-12', location: 'Audit' },
  { id: 9, floor: '2nd', item: 'Camera', invoiceNo: '', serialNumber: 'GF3542045', type: 'DS-2CD1321G2-LIU (2.8mm)', brand: 'Hikvision', defaultIp: '192.168.10.137', warranty: '2Y', invoiceDate: '2026-01-21', location: 'RMV Document Room' },
  { id: 10, floor: 'Ground', item: 'POE Switch', invoiceNo: 'AIS 00472', serialNumber: 'GH9236352', type: 'DS-3E1318P-EI/M-130', brand: 'Hikvision', defaultIp: '16 Port', warranty: '2Y', invoiceDate: '2026-01-27', location: '' },
  { id: 11, floor: 'Ground', item: 'Camera', invoiceNo: 'AN005222', serialNumber: 'GL9534481', type: 'DS-2CD1027G3-LIU 2MP 30M IR', brand: 'Hikvision', defaultIp: '192.168.10.138', warranty: '2Y', invoiceDate: '2026-01-27', location: 'Front 2nd Gate' },
  { id: 12, floor: 'Ground', item: 'Camera', invoiceNo: 'AN005222', serialNumber: 'GL9534210', type: 'DS-2CD1027G3-LIU 2MP 30M IR', brand: 'Hikvision', defaultIp: '192.168.10.139', warranty: '2Y', invoiceDate: '2026-01-27', location: 'Front Entrance' },
  { id: 13, floor: 'Ground', item: 'Camera', invoiceNo: 'AN005222', serialNumber: 'GL9534153', type: 'DS-2CD1027G3-LIU 2MP 30M IR', brand: 'Hikvision', defaultIp: '192.168.10.143', warranty: '2Y', invoiceDate: '2026-01-27', location: 'Staff Bike Yard' },
  { id: 14, floor: 'Ground', item: 'Camera', invoiceNo: 'AN005222', serialNumber: 'GL9534149', type: 'DS-2CD1027G3-LIU 2MP 30M IR', brand: 'Hikvision', defaultIp: '192.168.10.142', warranty: '2Y', invoiceDate: '2026-01-27', location: '1st Floor Vehicle Entrance' },
  { id: 15, floor: 'Ground', item: 'Camera', invoiceNo: 'AN005222', serialNumber: 'GL9534886', type: 'DS-2CD1027G3-LIU 2MP 30M IR', brand: 'Hikvision', defaultIp: '192.168.10.140', warranty: '2Y', invoiceDate: '2026-01-27', location: 'Ground Floor Yard' },
  { id: 16, floor: 'Ground', item: 'Camera', invoiceNo: 'AN005222', serialNumber: 'GL9534439', type: 'DS-2CD1027G3-LIU 2MP 30M IR', brand: 'Hikvision', defaultIp: '192.168.10.141', warranty: '2Y', invoiceDate: '2026-01-27', location: 'Front 1st Gate' },
  { id: 17, floor: '3rd', item: 'Camera', invoiceNo: '', serialNumber: 'GL7533453', type: 'DS-2CD1327G3-LIU (2.8mm)', brand: 'Hikvision', defaultIp: '192.168.10.145', warranty: '2Y', invoiceDate: '2026-02-21', location: 'Call Center' },
];

/** Format local mobile numbers for display (Sri Lanka). */
export function formatLkPhone(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '—';
  let n = digits;
  if (n.startsWith('94') && n.length === 11) n = `0${n.slice(2)}`;
  if (n.length === 9 && !n.startsWith('0')) n = `0${n}`;
  if (n.length === 10) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  return n;
}

export function phoneTelHref(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  let n = digits;
  if (n.length === 9 && !n.startsWith('0')) n = `0${n}`;
  if (n.startsWith('0')) return `tel:+94${n.slice(1)}`;
  if (n.startsWith('94')) return `tel:+${n}`;
  return `tel:${n}`;
}
