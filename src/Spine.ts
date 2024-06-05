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
    View
} from 'pixi.js';
import { ISpineDebugRenderer } from './SpineDebugRenderer';
import {
    AnimationState,
    AnimationStateData,
    AtlasAttachmentLoader,
    Attachment,
    Bone,
    MeshAttachment,
    RegionAttachment,
    Skeleton,
    SkeletonBinary,
    SkeletonBounds,
    SkeletonData,
    SkeletonJson,
    Slot,
    type TextureAtlas,
    TrackEntry,
    Vector2
} from '@esotericsoftware/spine-core';

export type SpineFromOptions = {
    skeleton: string;
    atlas: string;
    scale?: number;
};

const vectorAux = new Vector2();

Skeleton.yDown = true;

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
    vertices: Float32Array;
    indices: number[];
    uvs: number[];
    color: { r: number; g: number; b: number; a: number };
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
    private _bounds:Bounds = new Bounds();

    // Spine properties
    public skeleton: Skeleton;
    public state: AnimationState;
    public skeletonBounds: SkeletonBounds;
    private _debug?: ISpineDebugRenderer | undefined = undefined;

    readonly _slotAttachments:{slot:Slot, container:Container}[] = [];

    public spineAttachmentsDirty: boolean;
    private _lastAttachments: Attachment[];

    private _stateChanged: boolean;
    private attachmentCache: Record<string, AttachmentCacheData> = {};

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

    constructor(options:SpineOptions | SkeletonData)
    {
        if (options instanceof SkeletonData)
        {
            options = {
                skeletonData: options
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
            // eslint-disable-next-line max-len
            console.warn('You are calling update on a Spine instance that has autoUpdate set to true. This is probably not what you want.');
            this.autoUpdateWarned = true;
        }

        this.internalUpdate(0, dt);
    }

    protected internalUpdate(_deltaFrame: any, deltaSeconds?: number): void
    {
        // Because reasons, pixi uses deltaFrames at 60fps.
        // We ignore the default deltaFrames and use the deltaSeconds from pixi ticker.
        this.updateState(deltaSeconds ?? Ticker.shared.deltaMS / 1000);
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

    updateState(dt:number)
    {
        this.state.update(dt);

        this._stateChanged = true;

        this._boundsDirty = true;

        this.onViewUpdate();
    }

    updateSlotAttachments()
    {
        for (let i = 0; i < this._slotAttachments.length; i++)
        {
            const slotAttachment = this._slotAttachments[i];

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
                    Math.cos(rotationX) + Math.cos(rotationY)
                );
            }
        }
    }

    applyState()
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

    getCachedData(slot: Slot, attachment: RegionAttachment | MeshAttachment):AttachmentCacheData
    {
        const key = `${slot.data.index}-${attachment.name}`;

        return this.attachmentCache[key] || this.initCachedData(slot, attachment);
    }

    private validateAttachments()
    {
        const currentDrawOrder = this.skeleton.drawOrder;

        const lastAttachments = this._lastAttachments ||= [];

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
                if (attachment instanceof MeshAttachment)
                {
                    const cacheData = this.getCachedData(slot, attachment);

                    attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, cacheData.vertices, 0, 2);
                }
                else if (attachment instanceof RegionAttachment)
                {
                    const cacheData = this.getCachedData(slot, attachment);

                    attachment.computeWorldVertices(slot, cacheData.vertices, 0, 2);
                }
            }
        }
    }

    private initCachedData(slot: Slot, attachment: RegionAttachment | MeshAttachment):AttachmentCacheData
    {
        const key = `${slot.data.index}-${attachment.name}`;

        let vertices:Float32Array;

        if (attachment instanceof RegionAttachment)
        {
            vertices = new Float32Array(8);

            this.attachmentCache[key] = {
                vertices,
                indices: [0, 1, 2, 0, 2, 3],
                uvs: attachment.uvs as number[],
                color: slot.color
            };
        }
        else
        {
            vertices = new Float32Array(attachment.worldVerticesLength);

            this.attachmentCache[key] = {
                vertices,
                indices: attachment.triangles,
                uvs: attachment.uvs as number[],
                color: slot.color
            };
        }

        return this.attachmentCache[key];
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
     * @param slot - The slot id or  slot to attach to
     */
    attachToSlot(container:Container, slot:string | Slot)
    {
        this.detachFromSlot(container, slot);

        container.includeInBuild = false;

        if (typeof slot === 'string')
        {
            slot = this.skeleton.findSlot(slot) as Slot;
        }

        if (!slot)
        {
            throw new Error(`Slot ${slot} not found`);
        }

        // TODO only add once??
        this.addChild(container);

        // TODO search for copies... - one container - to one bone!
        this._slotAttachments.push({
            slot,
            container
        });
    }

    /**
     * Removes a PixiJS container from the slot it is attached to.
     *
     * @param container - The container to detach from the slot
     * @param slot - The slot id or slot to detach from
     */
    detachFromSlot(container:Container, slot:string | Slot)
    {
        container.includeInBuild = true;

        if (typeof slot === 'string')
        {
            slot = this.skeleton.findSlot(slot) as Slot;
        }

        if (!slot)
        {
            throw new Error(`Bone ${slot} not found`);
        }

        this.removeChild(container);

        for (let i = 0; i < this._slotAttachments.length; i++)
        {
            const mapping = this._slotAttachments[i];

            if (mapping.slot === slot && mapping.container === container)
            {
                this._slotAttachments.splice(i, 1);
                break;
            }
        }
    }

    /**
     * Returns a container attached to a slot, or undefined if no container is attached.
     *
     * @param slot - The slot id or slot to get the attachment from
     * @returns - The container attached to the slot
     */
    getSlotAttachment(slot:string | Slot)
    {
        if (typeof slot === 'string')
        {
            slot = this.skeleton.findSlot(slot) as Slot;
        }

        if (!slot)
        {
            throw new Error(`Slot ${slot} not found`);
        }

        return this._slotAttachments.find((mapping) => mapping.slot === slot)?.container;
    }

    updateBounds()
    {
        this._boundsDirty = false;

        this.skeletonBounds ||= new SkeletonBounds();

        const skeletonBounds = this.skeletonBounds;

        skeletonBounds.update(this.skeleton, true);

        if (skeletonBounds.minX === Infinity)
        {
            this.applyState();

            const drawOrder = this.skeleton.drawOrder;
            const bounds = this._bounds;

            bounds.clear();

            for (let i = 0; i < drawOrder.length; i++)
            {
                const slot = drawOrder[i];

                const attachment = slot.getAttachment();

                if (attachment && attachment instanceof RegionAttachment || attachment instanceof MeshAttachment)
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
        (this._slotAttachments as any) = null;
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

    static from({ skeleton, atlas, scale = 1 }:SpineFromOptions)
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
        const parser = skeletonAsset instanceof Uint8Array ? new SkeletonBinary(attachmentLoader) : new SkeletonJson(attachmentLoader);

        // TODO scale?
        parser.scale = scale;
        const skeletonData = parser.readSkeletonData(skeletonAsset);

        Cache.set(cacheKey, skeletonData);

        return new Spine({
            skeletonData
        });
    }
}
