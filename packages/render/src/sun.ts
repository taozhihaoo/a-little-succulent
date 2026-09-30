/** 主光方向（世界空间）——SceneRoot.setDayPhase 写入，叶片背光 shader 读取 */
import * as THREE from 'three'

export const sunState = { dir: new THREE.Vector3(0.55, 0.75, 0.62).normalize() }
