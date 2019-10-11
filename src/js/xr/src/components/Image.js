const { useUpdate } = require('react-three-fiber')
const { useEffect } = require('react')

const VirtualCamera = require('../components/VirtualCamera')

const Image = React.memo(({ sceneObject, isSelected }) => {
  const ref = useUpdate(
    self => {
      self.traverse(child => child.layers.enable(VirtualCamera.VIRTUAL_CAMERA_LAYER))
    }
  )

  const { x, y, z, visible, width, height, rotation } = sceneObject

  useEffect(() => {
    const { material } = ref.current
    if (isSelected) {
      material.emissive = new THREE.Color(0x755bf9)
      material.color = new THREE.Color(0x222222)
    } else {
      material.emissive = new THREE.Color(0x000000)
      material.color = new THREE.Color(0xcccccc)
    }
  }, [ref.current, isSelected])

  return (
    <mesh
      ref={ref}
      
      onController={sceneObject.visible ? () => null : null}
      userData={{
        type: 'image',
        id: sceneObject.id
      }}

      visible={visible}
      position={[x, z, y]}
      scale={[width, height, 1]}
      rotation={[rotation.x, rotation.y, rotation.z]}
    >
      <boxBufferGeometry attach='geometry' args={[1, 1, 0.01]} />
      <meshToonMaterial attach='material' side={THREE.FrontSide}></meshToonMaterial>
    </mesh>
  )
})

module.exports = Image
