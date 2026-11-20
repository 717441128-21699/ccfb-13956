/**
 * 测试城市预设: 纬度拉开跨度, 含南半球与高纬地区。
 */
import type { GeoLocation } from './dialGeometry';

export const CITIES: GeoLocation[] = [
  { name: '北京', latitudeDeg: 39.9042, longitudeDeg: 116.4074 },
  { name: '上海', latitudeDeg: 31.2304, longitudeDeg: 121.4737 },
  { name: '新加坡', latitudeDeg: 1.3521, longitudeDeg: 103.8198 },
  { name: '悉尼', latitudeDeg: -33.8688, longitudeDeg: 151.2093 },
  { name: '特罗姆瑟(挪威)', latitudeDeg: 69.6492, longitudeDeg: 18.9553 },
  { name: '开罗', latitudeDeg: 30.0444, longitudeDeg: 31.2357 },
  { name: '利马', latitudeDeg: -12.0464, longitudeDeg: -77.0428 },
  { name: '雷克雅未克', latitudeDeg: 64.1466, longitudeDeg: -21.9426 },
];
