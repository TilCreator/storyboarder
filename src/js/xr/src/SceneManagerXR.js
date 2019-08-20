const THREE = require('three')
window.THREE = window.THREE || THREE
const { Canvas, useThree, useRender } = require('react-three-fiber')

const { connect, Provider } = require('react-redux')
const useReduxStore = require('react-redux').useStore
const { useMemo, useRef, Suspense } = React = require('react')

const { create } = require('zustand')
const { produce } = require('immer')

const { WEBVR } = require('three/examples/jsm/vr/WebVR')

const {
  // selectors
  getSceneObjects,
  getWorld,
  getActiveCamera,
  getSelections,

  // action creators
  selectObject
} = require('../../shared/reducers/shot-generator')

const useRStats = require('./hooks/use-rstats')
const useVrControllers = require('./hooks/use-vr-controllers')

const Stats = require('./components/Stats')
const Ground = require('./components/Ground')
const Character = require('./components/Character')
const ModelObject = require('./components/ModelObject')
const Controller = require('./components/Controller')
const TeleportTarget = require('./components/TeleportTarget')

const rotatePoint = require('./helpers/rotate-point')
const teleportParent = require('./helpers/teleport-parent')
const getControllerIntersections = require('./helpers/get-controller-intersections')
const findMatchingAncestor = require('./helpers/find-matching-ancestor')

const { createSelector } = require('reselect')

// TODO move to selectors if useful
// TODO optimize to only change if top-level keys change
const getSceneObjectCharacterIds = createSelector(
  [getSceneObjects],
  sceneObjects => Object.values(sceneObjects).filter(o => o.type === 'character').map(o => o.id)
)
const getSceneObjectModelObjectIds = createSelector(
  [getSceneObjects],
  sceneObjects => Object.values(sceneObjects).filter(o => o.type === 'object').map(o => o.id)
)

const teleportState = ({ teleportPos, teleportRot }, camera, x, y, z, r) => {
  // create virtual parent and child
  let parent = new THREE.Object3D()
  parent.position.set(teleportPos.x, teleportPos.y, teleportPos.z)
  parent.rotation.set(teleportRot.x, teleportRot.y, teleportRot.z)

  let child = new THREE.Object3D()
  child.position.copy(camera.position)
  child.rotation.copy(camera.rotation)
  parent.add(child)
  parent.updateMatrixWorld()

  // teleport the virtual parent
  teleportParent(parent, child, x, y, z, r)

  // update state from new position of virtual parent
  teleportPos.x = parent.position.x
  teleportPos.y = parent.position.y
  teleportPos.z = parent.position.z

  teleportRot.x = parent.rotation.x
  teleportRot.y = parent.rotation.y
  teleportRot.z = parent.rotation.z
}

const [useStore, useStoreApi] = create((set, get) => ({
  // values
  teleportPos: { x: 0, y: 0, z: 0 },
  teleportRot: { x: 0, y: 0, z: 0 },

  didMoveCamera: null,
  didRotateCamera: null,

  teleportMaxDist: 10,
  teleportMode: false,
  teleportTargetPos: [0, 0, 0],
  teleportTargetValid: false,

  // actions
  setDidMoveCamera: value => set(produce(state => { state.didMoveCamera = value })),
  setDidRotateCamera: value => set(produce(state => { state.didRotateCamera = value })),
  setTeleportMode: value => set(state => ({ ...state, teleportMode: value })),

  moveCameraByDistance: (camera, distance) => set(produce(state => {
    let center = new THREE.Vector3()
    camera.getWorldPosition(center)
    let gr = camera.rotation.y + state.teleportRot.y

    let target = new THREE.Vector3(center.x, 0, center.z + distance)
    let d = rotatePoint(target, center, -gr)
    teleportState(state, camera, d.x, null, d.z, null)
  })),

  rotateCameraByRadians: (camera, radians) => set(produce(state => {
    let center = new THREE.Vector3()
    camera.getWorldPosition(center)
    let gr = camera.rotation.y + state.teleportRot.y

    teleportState(state, camera, null, null, null, gr + radians)
  })),

  teleport: (camera, x, y, z, r) => set(produce(state => {
    teleportState(state, camera, x, y, z, r)
  })),

  set: fn => set(produce(fn))
}))

const SceneContent = connect(
  state => ({
    sceneObjects: getSceneObjects(state),
    world: getWorld(state),
    activeCamera: getActiveCamera(state),
    selections: getSelections(state),

    characterIds: getSceneObjectCharacterIds(state),
    modelObjectIds: getSceneObjectModelObjectIds(state)
  }),
  {
    selectObject
  }
)(
  ({
    sceneObjects, world, activeCamera, selections,

    characterIds, modelObjectIds,

    selectObject
  }) => {
    const oppositeController = controller => controllers.find(i => i.uuid !== controller.uuid)

    const onSelectStart = event => {
      const controller = event.target
      controller.pressed = true

      if (teleportMode) {
        onTeleport()
        return
      }

      let match = null
      let list = scene.__interaction.filter(object3d => object3d.userData.type != 'character')

      // find the positioned controller based on the data controller's gamepad array index
      let positionedObject = controllerObjects[event.target.gamepad.index]
      // gather all hits to tracked scene object3ds
      let hits = getControllerIntersections(positionedObject, list)
      // if one intersects
      if (hits.length) {
        // grab the first intersection
        let child = hits[0].object
        // find either the child or one of its parents on the list of interaction-ables
        match = findMatchingAncestor(child, list)
      }

      if (match) {
        console.log('found sceneObject:', sceneObjects[match.userData.id])
        selectObject(match.userData.id)
      } else {
        console.log('clearing selection')
        selectObject(null)
      }
    }

    const onSelectEnd = event => {
      const controller = event.target
      controller.pressed = false
    }

    const onGripDown = event => {
      const controller = event.target
      controller.gripped = true

      let other = oppositeController(controller)
      if (other && other.gripped) {
        console.log('selecting mini mode')
        setTeleportMode(false)
        return
      }

      // the target position value will be old until the next gl render
      // so consider it invalid, to hide the mesh, until then
      set(state => ({ ...state, teleportTargetValid: false }))
      setTeleportMode(true)
    }

    const onGripUp = event => {
      const controller = event.target
      controller.gripped = false

      setTeleportMode(false)
    }

    const onAxesChanged = event => {
      onMoveCamera(event)
      onRotateCamera(event)
    }

    const onMoveCamera = event => {
      if (didMoveCamera != null) {
        if (event.axes[1] === 0) {
          setDidMoveCamera(null)
        }
      } else {
        if (Math.abs(event.axes[1]) < Math.abs(event.axes[0])) return

        let distance
        let value = event.axes[1]

        // backward
        if (value > 0.075) {
          distance = +1
        }

        // forward
        if (value < -0.075) {
          distance = -1
        }

        if (distance != null) {
          setDidMoveCamera(distance)
          moveCameraByDistance(camera, distance)
        }
      }
    }

    const onRotateCamera = event => {
      if (didRotateCamera != null) {
        if (event.axes[0] === 0) {
          setDidRotateCamera(null)
        }
      } else {
        if (Math.abs(event.axes[0]) < Math.abs(event.axes[1])) return

        // right
        if (event.axes[0] > 0.075) {
          setDidRotateCamera(-45)
          rotateCameraByRadians(camera, THREE.Math.degToRad(-45))
        }

        // left
        if (event.axes[0] < -0.075) {
          setDidRotateCamera(45)
          rotateCameraByRadians(camera, THREE.Math.degToRad(45))
        }
      }
    }

    const onTeleport = () => {
      // TODO adjust by worldScale
      // TODO reset worldScale after teleport

      if (teleportTargetValid) {
        let pos = useStoreApi.getState().teleportTargetPos
        teleport(pos[0], 0, pos[2], null)
        setTeleportMode(false)
      }
    }

    const store = useReduxStore()

    const { gl, camera, scene } = useThree()

    // values
    const teleportPos = useStore(state => state.teleportPos)
    const teleportRot = useStore(state => state.teleportRot)
    const didMoveCamera = useStore(state => state.didMoveCamera)
    const didRotateCamera = useStore(state => state.didRotateCamera)
    const teleportMode = useStore(state => state.teleportMode)
    const teleportTargetValid = useStore(state => state.teleportTargetValid)
    const teleportMaxDist = useStore(state => state.teleportMaxDist)

    // actions
    const setDidMoveCamera = useStore(state => state.setDidMoveCamera)
    const setDidRotateCamera = useStore(state => state.setDidRotateCamera)
    const moveCameraByDistance = useStore(state => state.moveCameraByDistance)
    const rotateCameraByRadians = useStore(state => state.rotateCameraByRadians)
    const teleportFn = useStore(state => state.teleport)
    const teleport = (x, y, z, r) => teleportFn(camera, x, y, z, r)
    const setTeleportMode = useStore(state => state.setTeleportMode)
    const set = useStore(state => state.set)

    // initialize behind the camera, on the floor
    useMemo(() => {
      const { x, y, rotation } = sceneObjects[activeCamera]

      const behindCam = {
        x: Math.sin(rotation),
        y: Math.cos(rotation)
      }

      set(state => {
        state.teleportPos.x = x + behindCam.x
        state.teleportPos.y = 0
        state.teleportPos.z = y + behindCam.y

        state.teleportRot.x = 0
        state.teleportRot.y = rotation
        state.teleportRot.z = 0
      })
    }, [])

    useMemo(() => {
      scene.background = new THREE.Color(0x000000)
      scene.fog = new THREE.Fog( 0x000000, -10, 40 )
    })

    const teleportTexture = useMemo(
      () => new THREE.TextureLoader().load('/data/system/xr/teleport.png'), []
    )
    const groundTexture = useMemo(
      () => new THREE.TextureLoader().load('/data/system/grid_floor_1.png'), []
    )

    const rStats = useRStats()

    const teleportRef = useRef()
    const groundRef = useRef()

    // controller objects via THREE.WebVRManager
    const controllerObjects = useMemo(
      () => [gl.vr.getController(0), gl.vr.getController(1)],
      []
    )

    // controller state via THREE.VRController
    const controllers = useVrControllers({
      onSelectStart,
      onSelectEnd,
      onGripDown,
      onGripUp,
      onAxesChanged
    })

    // const controllerLeft = useMemo(() => controllers.find(c => c.getHandedness() === 'left'), [controllers])
    // const controllerRight = useMemo(() => controllers.find(c => c.getHandedness() === 'right'), [controllers])
    // navigator.getGamepads()[0].hand

    useRender(() => {
      // don't wait for a React update
      // read values directly from stores
      let teleportMode = useStoreApi.getState().teleportMode
      let selections = getSelections(store.getState())
      let selectedId = selections.length && selections[0]

      if (teleportMode) {
        for (let i = 0; i < controllerObjects.length; i++) {
          // via WebVRManager
          let positionedObject = controllerObjects[i]
          // via THREE.VRController
          let dataObject = controllers[i]
          // we need both
          if (!(positionedObject && dataObject)) continue

          if (dataObject.gripped) {
            let hits = getControllerIntersections(positionedObject, [groundRef.current])
            if (hits.length) {
              let hit = hits[0]
              if (hit.distance < teleportMaxDist) {
                let teleportTargetPos = hit.point.toArray()
                set(state => ({ ...state, teleportTargetPos, teleportTargetValid: true }))
              } else {
                set(state => ({ ...state, teleportTargetValid: false }))
              }
            }
          }
        }
      }

      if (selectedId) {
        let object3d = scene.__interaction.find(o => o.userData.id === selectedId)

        // TODO handle if object3d no longer exists
        //      e.g.: if scene was changed externally

        for (let i = 0; i < controllers.length; i++) {
          const controller = controllers[i]

          if (controller.pressed) {
            if (object3d) {
              // TODO position/rotate object3d based on controller3d
            }
          }
        }
      }
    }, false, [set, controllerObjects, controllers])

    return (
      <>
        <group
          ref={teleportRef}
          position={[teleportPos.x, teleportPos.y, teleportPos.z]}
          rotation={[teleportRot.x, teleportRot.y, teleportRot.z]}
        >
          <primitive object={camera}>
            <Stats rStats={rStats} position={[0, 0, -1]} />
          </primitive>

          <Suspense fallback={null}>
            <primitive object={controllerObjects[0]}>
              <Controller />
            </primitive>
          </Suspense>

          <Suspense fallback={null}>
            <primitive object={controllerObjects[1]}>
              <Controller />
            </primitive>
          </Suspense>
        </group>

        <ambientLight color={0xffffff} intensity={world.ambient.intensity} />

        <directionalLight
          ref={ref => {
            if (ref) {
              ref.add(ref.target)

              ref.rotation.x = 0
              ref.rotation.z = 0
              ref.rotation.y = world.directional.rotation

              ref.rotateX(world.directional.tilt + Math.PI / 2)
            }
          }}
          color={0xffffff}
          intensity={world.directional.intensity}
          position={[0, 1.5, 0]}
          target-position={[0, 0, 0.4]}
        />

        {
          characterIds.map(id =>
            <Suspense key={id} fallback={null}>
              <Character sceneObject={sceneObjects[id]} />
            </Suspense>
          )
        }

        {
          modelObjectIds.map(id =>
            <Suspense key={id} fallback={null}>
              <ModelObject sceneObject={sceneObjects[id]} isSelected={selections.includes(id)} />
            </Suspense>
          )
        }

        <Ground
          objRef={groundRef}
          texture={groundTexture}
          visible={true/*!world.room.visible && world.ground*/} />

        <TeleportTarget
          api={useStoreApi}
          visible={teleportMode && teleportTargetValid}
          texture={teleportTexture}
        />
      </>
    )
  })

const XRStartButton = ({ }) => {
  const { gl } = useThree()
  useMemo(() => document.body.appendChild(WEBVR.createButton(gl)), [])
  return null
}

const SceneManagerXR = () => {
  const store = useReduxStore()

  const loaded = true

  return (
    <>
      {
        !loaded && <div className='loading-button'>LOADING …</div>
      }
      <Canvas vr>
        <Provider store={store}>
          {
            loaded && <XRStartButton />
          }
          <SceneContent />
        </Provider>
      </Canvas>
      <div className='scene-overlay' />
    </>
  )
}

module.exports = SceneManagerXR
