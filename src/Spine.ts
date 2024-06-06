/** ****************************************************************************
 * Spine Runtimes License Agreement
 * Last updated July 28, 2023. Replaces all prior versions.
 *
 * Copyright (c) 2013-2023, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software or
 * otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THE
 * SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

import {
    Assets,
    Bounds,
    Cache,
    Container,
    ContainerOptions,
    DEG_TO_RAD,
    DestroyOptions,
    PointData,
    Ticker,
    View,
} from 'pixi.js';
import { ISpineDebugRenderer } from './SpineDebugRenderer';
import {
    AnimationState,
    AnimationStateData,
    AtlasAttachmentLoader,
    Attachment,
    Bone,
    ClippingAttachment,
    Color,
    MeshAttachment,
    RegionAttachment,
    Skeleton,
    SkeletonBinary,
    SkeletonBounds,
    SkeletonClipping,
    SkeletonData,
    SkeletonJson,
    Slot,
    type TextureAtlas,
    TrackEntry,
    Vector2,
} from '@esotericsoftware/spine-core';

export type SpineFromOptions = {
    skeleton: string;
    atlas: string;
    scale?: number;
};

const vectorAux = new Vector2();
const lightColor = new Color();
const darkColor = new Color();

Skeleton.yDown = true;

const clipper = new SkeletonClipping();

export interface SpineOptions extends ContainerOptions
{
    skeletonData: SkeletonData;
    autoUpdate?: boolean;
}

export interface SpineEvents
{
    complete: [trackEntry: TrackEntry];
    dispose: [trackEntry: TrackEntry];
    end: [trackEntry: TrackEntry];
    event: [trackEntry: TrackEntry, event: Event];
    interrupt: [trackEntry: TrackEntry];
    start: [trackEntry: TrackEntry];
}

export interface AttachmentCacheData
{
    clipped: boolean;
    vertices: Float32Array;
    uvs: Float32Array;
    indices: number[];
    color: { r: number; g: number; b: number; a: number };
    clippedData?: {
        vertices: Float32Array;
        uvs: Float32Array;
        indices: Uint16Array;
        vertexCount: number;
        indicesCount: number;
    };
}

export class Spine extends Container implements View
{
    // Pixi properties
    public batched = true;
    public buildId = 0;
    public override readonly renderPipeId = 'spine';
    public _didSpineUpdate = false;
    public _boundsDirty = true;
    public _roundPixels: 0 | 1;
    private _bounds: Bounds = new Bounds();

    // Spine properties
    public skeleton: Skeleton;
    public state: AnimationState;
    public skeletonBounds: SkeletonBounds;
    private _debug?: ISpineDebugRenderer | undefined = undefined;

    readonly _slotsObject: Record<string, {slot:Slot, container:Container}> = Object.create(null);

    private getSlotFromRef(slotRef: number | string | Slot): Slot
    {
        let slot: Slot | null;

        if (typeof slotRef === 'number') slot = this.skeleton.slots[slotRef];
        else if (typeof slotRef === 'string') slot = this.skeleton.findSlot(slotRef);
        else slot = slotRef;

        if (!slot) throw new Error(`No slot found with the given slot reference: ${slotRef}`);

        return slot;
    }

    public spineAttachmentsDirty: boolean;
    private _lastAttachments: Attachment[];

    private _stateChanged: boolean;
    private attachmentCacheData: Record<string, AttachmentCacheData> = {};

    public get debug(): ISpineDebugRenderer | undefined
    {
        return this._debug;
    }

    public set debug(value: ISpineDebugRenderer | undefined)
    {
        if (this._debug)
        {
            this._debug.unregisterSpine(this);
        }
        if (value)
        {
            value.registerSpine(this);
        }
        this._debug = value;
    }

    private autoUpdateWarned = false;
    private _autoUpdate = true;

    public get autoUpdate(): boolean
    {
        return this._autoUpdate;
    }

    public set autoUpdate(value: boolean)
    {
        if (value)
        {
            Ticker.shared.add(this.internalUpdate, this);
            this.autoUpdateWarned = false;
        }
        else
        {
            Ticker.shared.remove(this.internalUpdate, this);
        }

        this._autoUpdate = value;
    }

    constructor(options: SpineOptions | SkeletonData)
    {
        if (options instanceof SkeletonData)
        {
            options = {
                skeletonData: options,
            };
        }

        super();

        const skeletonData = options instanceof SkeletonData ? options : options.skeletonData;

        this.skeleton = new Skeleton(skeletonData);
        this.state = new AnimationState(new AnimationStateData(skeletonData));
        this.autoUpdate = options?.autoUpdate ?? true;
    }

    public update(dt: number): void
    {
        if (this.autoUpdate && !this.autoUpdateWarned)
        {
            console.warn(
                // eslint-disable-next-line max-len
                'You are calling update on a Spine instance that has autoUpdate set to true. This is probably not what you want.',
            );
            this.autoUpdateWarned = true;
        }

        this.internalUpdate(0, dt);
    }

    protected internalUpdate(_deltaFrame: any, deltaSeconds?: number): void
    {
        // Because reasons, pixi uses deltaFrames at 60fps.
        // We ignore the default deltaFrames and use the deltaSeconds from pixi ticker.
        this._updateState(deltaSeconds ?? Ticker.shared.deltaMS / 1000);
    }

    get bounds()
    {
        if (this._boundsDirty)
        {
            this.updateBounds();
        }

        return this._bounds;
    }

    public setBonePosition(bone: string | Bone, position: PointData): void
    {
        const boneAux = bone;

        if (typeof bone === 'string')
        {
            bone = this.skeleton.findBone(bone) as Bone;
        }

        if (!bone) throw Error(`Cant set bone position, bone ${String(boneAux)} not found`);
        vectorAux.set(position.x, position.y);

        if (bone.parent)
        {
            const aux = bone.parent.worldToLocal(vectorAux);

            bone.x = aux.x;
            bone.y = -aux.y;
        }
        else
        {
            bone.x = vectorAux.x;
            bone.y = vectorAux.y;
        }
    }

    public getBonePosition(bone: string | Bone, outPos?: PointData): PointData | undefined
    {
        const boneAux = bone;

        if (typeof bone === 'string')
        {
            bone = this.skeleton.findBone(bone) as Bone;
        }

        if (!bone)
        {
            console.error(`Cant set bone position! Bone ${String(boneAux)} not found`);

            return outPos;
        }

        if (!outPos)
        {
            outPos = { x: 0, y: 0 };
        }

        outPos.x = bone.worldX;
        outPos.y = bone.worldY;

        return outPos;
    }

    /**
     * Will update the state based on the specified time, this will not apply the state to the skeleton
     * as this is differed until the `applyState` method is called.
     *
     * @param time the time at which to set the state
     * @internal
     */
    _updateState(time: number)
    {
        this.state.update(time);

        this._stateChanged = true;

        this._boundsDirty = true;

        this.onViewUpdate();
    }

    /**
     * Applies the state to this spine instance.
     * - updates the state to the skeleton
     * - updates its world transform (spine world transform)
     * - validates the attachments - to flag if the attachments have changed this state
     * - transforms the attachments - to update the vertices of the attachments based on the new positions
     * - update the slot attachments - to update the position, rotation, scale, and visibility of the attached containers
     * @internal
     */
    _applyState()
    {
        if (!this._stateChanged) return;
        this._stateChanged = false;

        const { skeleton } = this;

        this.state.apply(skeleton);

        skeleton.updateWorldTransform();

        this.validateAttachments();

        this.transformAttachments();

        this.updateSlotAttachments();
    }

    private validateAttachments()
    {
        const currentDrawOrder = this.skeleton.drawOrder;

        const lastAttachments = (this._lastAttachments ||= []);

        let index = 0;

        let spineAttachmentsDirty = false;

        for (let i = 0; i < currentDrawOrder.length; i++)
        {
            const slot = currentDrawOrder[i];
            const attachment = slot.getAttachment();

            if (attachment)
            {
                if (attachment !== lastAttachments[index])
                {
                    spineAttachmentsDirty = true;
                    lastAttachments[index] = attachment;
                }

                index++;
            }
        }

        if (index !== lastAttachments.length)
        {
            spineAttachmentsDirty = true;
            lastAttachments.length = index;
        }

        this.spineAttachmentsDirty = spineAttachmentsDirty;
    }

    private transformAttachments()
    {
        const currentDrawOrder = this.skeleton.drawOrder;

        for (let i = 0; i < currentDrawOrder.length; i++)
        {
            const slot = currentDrawOrder[i];

            const attachment = slot.getAttachment();

            if (attachment)
            {
                if (attachment instanceof MeshAttachment || attachment instanceof RegionAttachment)
                {
                    const cacheData = this.getCachedData(slot, attachment);

                    if (attachment instanceof RegionAttachment)
                    {
                        attachment.computeWorldVertices(slot, cacheData.vertices, 0, 2);
                    }
                    else
                    {
                        attachment.computeWorldVertices(
                            slot,
                            0,
                            attachment.worldVerticesLength,
                            cacheData.vertices,
                            0,
                            2,
                        );
                    }

                    cacheData.clipped = false;

                    if (clipper.isClipping())
                    {
                        this.updateClippingData(cacheData);
                    }
                }
                else if (attachment instanceof ClippingAttachment)
                {
                    clipper.clipStart(slot, attachment);
                }
                else
                {
                    clipper.clipEndWithSlot(slot);
                }
            }
        }

        clipper.clipEnd();
    }

    private updateClippingData(cacheData: AttachmentCacheData)
    {
        cacheData.clipped = true;

        clipper.clipTriangles(
            cacheData.vertices,
            cacheData.vertices.length,
            cacheData.indices,
            cacheData.indices.length,
            cacheData.uvs,
            lightColor,
            darkColor,
            false,
        );

        const { clippedVertices, clippedTriangles } = clipper;

        const verticesCount = clippedVertices.length / 8;
        const indicesCount = clippedTriangles.length;

        if (!cacheData.clippedData)
        {
            cacheData.clippedData = {
                vertices: new Float32Array(verticesCount * 2),
                uvs: new Float32Array(verticesCount * 2),
                vertexCount: verticesCount,
                indices: new Uint16Array(indicesCount),
                indicesCount,
            };

            this.spineAttachmentsDirty = true;
        }

        const clippedData = cacheData.clippedData;

        const sizeChange = clippedData.vertexCount !== verticesCount || indicesCount !== clippedData.indicesCount;

        if (sizeChange)
        {
            this.spineAttachmentsDirty = true;

            if (clippedData.vertexCount < verticesCount)
            {
                // buffer reuse!
                clippedData.vertices = new Float32Array(verticesCount * 2);
                clippedData.uvs = new Float32Array(verticesCount * 2);
            }

            if (clippedData.indices.length < indicesCount)
            {
                clippedData.indices = new Uint16Array(indicesCount);
            }
        }

        const { vertices, uvs, indices } = clippedData;

        for (let i = 0; i < verticesCount; i++)
        {
            vertices[i * 2] = clippedVertices[i * 8];
            vertices[(i * 2) + 1] = clippedVertices[(i * 8) + 1];

            uvs[i * 2] = clippedVertices[(i * 8) + 6];
            uvs[(i * 2) + 1] = clippedVertices[(i * 8) + 7];
        }

        clippedData.vertexCount = verticesCount;

        for (let i = 0; i < indices.length; i++)
        {
            indices[i] = clippedTriangles[i];
        }

        clippedData.indicesCount = indicesCount;
    }

    /**
     * ensure that attached containers map correctly to their slots
     * along with their position, rotation, scale, and visibility.
     */
    private updateSlotAttachments()
    {
        for (const i in this._slotsObject)
        {
            const slotAttachment = this._slotsObject[i];

            if (!slotAttachment) continue;

            const { slot, container } = slotAttachment;

            container.visible = this.skeleton.drawOrder.includes(slot);

            if (container.visible)
            {
                const bone = slot.bone;

                container.position.set(bone.worldX, bone.worldY);

                container.scale.x = bone.getWorldScaleX();
                container.scale.y = bone.getWorldScaleY();

                const rotationX = bone.getWorldRotationX() * DEG_TO_RAD;
                const rotationY = bone.getWorldRotationY() * DEG_TO_RAD;

                container.rotation = Math.atan2(
                    Math.sin(rotationX) + Math.sin(rotationY),
                    Math.cos(rotationX) + Math.cos(rotationY),
                );
            }
        }
    }

    getCachedData(slot: Slot, attachment: RegionAttachment | MeshAttachment): AttachmentCacheData
    {
        const key = `${slot.data.index}-${attachment.name}`;

        return this.attachmentCacheData[key] || this.initCachedData(slot, attachment);
    }

    private initCachedData(slot: Slot, attachment: RegionAttachment | MeshAttachment): AttachmentCacheData
    {
        const key = `${slot.data.index}-${attachment.name}`;

        let vertices: Float32Array;

        if (attachment instanceof RegionAttachment)
        {
            vertices = new Float32Array(8);

            this.attachmentCacheData[key] = {
                vertices,
                clipped: false,
                indices: [0, 1, 2, 0, 2, 3],
                uvs: attachment.uvs as Float32Array,
                color: slot.color,
            };
        }
        else
        {
            vertices = new Float32Array(attachment.worldVerticesLength);

            this.attachmentCacheData[key] = {
                vertices,
                clipped: false,
                indices: attachment.triangles,
                uvs: attachment.uvs as Float32Array,
                color: slot.color,
            };
        }

        return this.attachmentCacheData[key];
    }

    onViewUpdate()
    {
        // increment from the 12th bit!
        this._didChangeId += 1 << 12;

        this._boundsDirty = true;

        if (this.didViewUpdate) return;
        this.didViewUpdate = true;

        const renderGroup = this.renderGroup || this.parentRenderGroup;

        if (renderGroup)
        {
            renderGroup.onChildViewUpdate(this);
        }

        this.debug?.renderDebug(this);
    }

    /**
     * Attaches a PixiJS container to a specified slot. This will map the world transform of the slots bone
     * to the attached container. A container can only be attached to one slot at a time.
     *
     * @param container - The container to attach to the slot
     * @param slotRef - The slot id or  slot to attach to
     */
    addSlotObject(slot: number | string | Slot, container: Container)
    {
        slot = this.getSlotFromRef(slot);

        // need to check in on the container too...
        for (const i in this._slotsObject)
        {
            if (this._slotsObject[i]?.container === container)
            {
                this.removeSlotObject(this._slotsObject[i].slot);
            }
        }

        this.removeSlotObject(slot);

        container.includeInBuild = false;

        // TODO only add once??
        this.addChild(container);

        // TODO search for copies... - one container - to one bone!
        this._slotsObject[slot.data.name] = {
            container,
            slot
        };

        const renderGroup = this.renderGroup || this.parentRenderGroup;

        if (renderGroup)
        {
            renderGroup.structureDidChange = true;
        }
    }

    /**
     * Removes a PixiJS container from the slot it is attached to.
     *
     * @param container - The container to detach from the slot
     * @param slot - The slot id or slot to detach from
     */
    removeSlotObject(slot: number | string | Slot)
    {
        slot = this.getSlotFromRef(slot);

        const container = this._slotsObject[slot.data.name]?.container;

        if (container)
        {
            this.removeChild(container);

            container.includeInBuild = true;
        }

        this._slotsObject[slot.data.name] = null;
    }

    /**
     * Returns a container attached to a slot, or undefined if no container is attached.
     *
     * @param slotRef - The slot id or slot to get the attachment from
     * @returns - The container attached to the slot
     */
    getSlotObject(slot: number | string | Slot)
    {
        slot = this.getSlotFromRef(slot);

        return this._slotsObject[slot.data.name].container;
    }

    updateBounds()
    {
        this._boundsDirty = false;

        this.skeletonBounds ||= new SkeletonBounds();

        const skeletonBounds = this.skeletonBounds;

        skeletonBounds.update(this.skeleton, true);

        if (skeletonBounds.minX === Infinity)
        {
            this._applyState();

            const drawOrder = this.skeleton.drawOrder;
            const bounds = this._bounds;

            bounds.clear();

            for (let i = 0; i < drawOrder.length; i++)
            {
                const slot = drawOrder[i];

                const attachment = slot.getAttachment();

                if (attachment && (attachment instanceof RegionAttachment || attachment instanceof MeshAttachment))
                {
                    const cacheData = this.getCachedData(slot, attachment);

                    bounds.addVertexData(cacheData.vertices, 0, cacheData.vertices.length);
                }
            }
        }
        else
        {
            this._bounds.minX = skeletonBounds.minX;
            this._bounds.minY = skeletonBounds.minY;
            this._bounds.maxX = skeletonBounds.maxX;
            this._bounds.maxY = skeletonBounds.maxY;
        }
    }

    addBounds(bounds: Bounds)
    {
        bounds.addBounds(this.bounds);
    }

    public containsPoint(point: PointData)
    {
        const bounds = this.bounds;

        if (point.x >= bounds.minX && point.x <= bounds.maxX)
        {
            if (point.y >= bounds.minY && point.y <= bounds.maxY)
            {
                return true;
            }
        }

        return false;
    }

    /**
     * Destroys this sprite renderable and optionally its texture.
     * @param options - Options parameter. A boolean will act as if all options
     *  have been set to that value
     * @param {boolean} [options.texture=false] - Should it destroy the current texture of the renderable as well
     * @param {boolean} [options.textureSource=false] - Should it destroy the textureSource of the renderable as well
     */
    public override destroy(options: DestroyOptions = false)
    {
        super.destroy(options);

        Ticker.shared.remove(this.internalUpdate, this);
        this.state.clearListeners();
        this.debug = undefined;
        this.skeleton = null as any;
        this.state = null as any;
        (this._slotsObject as any) = null;
        this._lastAttachments = null;
        this.attachmentCacheData = null as any;
    }

    /** Whether or not to round the x/y position of the sprite. */
    get roundPixels()
    {
        return !!this._roundPixels;
    }

    set roundPixels(value: boolean)
    {
        this._roundPixels = value ? 1 : 0;
    }

    static from({ skeleton, atlas, scale = 1 }: SpineFromOptions)
    {
        const cacheKey = `${skeleton}-${atlas}`;

        if (Cache.has(cacheKey))
        {
            return new Spine(Cache.get<SkeletonData>(cacheKey));
        }

        const skeletonAsset = Assets.get<any | Uint8Array>(skeleton);

        const atlasAsset = Assets.get<TextureAtlas>(atlas);
        const attachmentLoader = new AtlasAttachmentLoader(atlasAsset);
        // eslint-disable-next-line max-len
        const parser
            = skeletonAsset instanceof Uint8Array
                ? new SkeletonBinary(attachmentLoader)
                : new SkeletonJson(attachmentLoader);

        // TODO scale?
        parser.scale = scale;
        const skeletonData = parser.readSkeletonData(skeletonAsset);

        Cache.set(cacheKey, skeletonData);

        return new Spine({
            skeletonData,
        });
    }
}
