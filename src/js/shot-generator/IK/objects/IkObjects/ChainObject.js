const {IKChain, IKHingeConstraint} = require( "../../core/three-ik");

// ChainObject is class which contains all info about chain
// From which element chain is starting and ending
// Joints constraints etc.
class ChainObject
{

    constructor(baseObjectName, lastObjectName, movingTarget = null, rootJointName = null)
    {
        this.controlTarget = movingTarget;
        this.chain = new IKChain();
        this.isChainObjectStarted = false;
        this.baseObjectName = baseObjectName;
        this.lastObjectName = lastObjectName;
        this.rootJointName = rootJointName;
        this.currentJoint = 0;
        this.constraints = [];
    }

    updateMatrix()
    {
        for (let joint of this.chain.joints)
        {
            joint.bone.updateMatrixWorld(true);
        }
    }
}
module.exports =  ChainObject;
