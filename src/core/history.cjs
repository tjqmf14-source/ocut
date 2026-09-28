'use strict';
const {validateProject}=require('./project.cjs');
class ProjectHistory {
  #current;#past=[];#future=[];#limit;
  constructor(project,limit=100){
    validateProject(project);if(!Number.isInteger(limit)||limit<1||limit>1000)throw Error('Invalid history limit');
    this.#current=structuredClone(project);this.#limit=limit;
  }
  get state(){return structuredClone(this.#current);}
  get canUndo(){return this.#past.length>0;}
  get canRedo(){return this.#future.length>0;}
  #advance(next){next.revision=this.#current.revision+1;next.modifiedAt=new Date().toISOString();validateProject(next);this.#current=next;return this.state;}
  apply(label,edit){
    if(typeof label!=='string'||!label)throw Error('Command needs a label');
    const draft=this.state;const result=edit(draft);
    if(result&&typeof result.then==='function')throw Error('History edits must be synchronous');
    if(draft.id!==this.#current.id||draft.createdAt!==this.#current.createdAt)throw Error('Document identity cannot change during an edit');
    validateProject(draft);
    if(JSON.stringify(draft)===JSON.stringify(this.#current))return this.state;
    const previous=this.state;
    // Clone again: callers must not retain a mutable reference to committed state.
    const next=this.#advance(structuredClone(draft));
    this.#past.push({label,state:previous});if(this.#past.length>this.#limit)this.#past.shift();this.#future=[];
    return next;
  }
  undo(){if(!this.canUndo)return this.state;const e=this.#past.at(-1);const old=this.state;const next=this.#advance(structuredClone(e.state));this.#past.pop();this.#future.push({label:e.label,state:old});return next;}
  redo(){if(!this.canRedo)return this.state;const e=this.#future.at(-1);const old=this.state;const next=this.#advance(structuredClone(e.state));this.#future.pop();this.#past.push({label:e.label,state:old});return next;}
}
module.exports={ProjectHistory};
